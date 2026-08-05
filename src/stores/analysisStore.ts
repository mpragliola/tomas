import { defineStore, acceptHMRUpdate } from 'pinia';
import { ref, shallowRef, watch } from 'vue';
import type { FrequencySpectrum, FFTConfig } from '../types/spectrum';
import type { ImpulseResponse, ToneCurve } from '../types/ir';
import type {
  RecordTarget,
  PlaybackMode,
  WavHeader,
  AudioAsset,
  ReferenceState,
  ReferenceSelection,
} from '../types/audio';
import type { GraphicEqBand, GraphicEqState } from '../types/graphicEq';
import { createDefaultGraphicEqState } from '../types/graphicEq';
import { logger } from '../services/logging';
import { computeAveragedFFT } from '../services/audio/fftProcessor';
import { extractSpectrum } from '../services/dsp/spectrum';
import { deriveToneCurve, renderToneMatchIR } from '../services/dsp/irDerivation';
import type { ToneMatchConfig } from '../services/dsp/irDerivation';
import { applyGraphicEq } from '../services/dsp/graphicEqResponse';
import {
  DEFAULT_FFT_CONFIG,
  DEFAULT_TONE_MATCH_CONFIG,
  LIVE_ANALYSER_SMOOTHING,
  MIN_ANALYSIS_SECONDS,
} from '../services/dsp/defaults';
import { measureHeadroomTrim } from '../services/audio/headroom';

/** Up to 8 reference tabs can be open at once — see `let-s-plan-a-complex-cached-turtle.md`. */
export const MAX_REFERENCES = 8;

/**
 * What a source-reading helper (`playbackChannels`, `playbackRate`, `resolveAudioSource`)
 * is being asked about: the working take, or a specific reference tab's asset. Same
 * shape as (and now also drives) `recordAudio`'s target — re-exported from `types/audio.ts`
 * as `RecordTarget` rather than duplicated, since components need it too.
 */
type AudioTarget = RecordTarget;

let idCounter = 0;
/** Prefixed and counter-suffixed rather than a bare UUID — reads better in logs, and this
 * app has no need for global uniqueness beyond one session. */
function generateId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export const useAnalysisStore = defineStore('analysis', () => {
  /**
   * User-facing counterpart to `logger.error` — the log line carries the technical
   * context, this carries a short plain-language message for a toast. Only set at
   * outer call sites (not nested/rethrowing catches) so one failure surfaces once.
   */
  let errorIdCounter = 0;
  const lastError = ref<{ id: number; message: string } | null>(null);
  function reportError(context: string, error: unknown, userMessage: string): void {
    logger.error('analysisStore', context, { error: String(error) });
    lastError.value = { id: ++errorIdCounter, message: userMessage };
  }

  // --- Slot A: flat, ungrouped refs. There is only ever one working take, so a
  // Record<'A', T> wrapper around a single key bought nothing once B stopped being a
  // fixed second key next to it. ---
  const audioBufferA = ref(new Float32Array());
  const channelBufferA = ref<Float32Array[]>([]);
  const sampleRateA = ref(44100);
  const audioHeaderA = ref<WavHeader | null>(null);
  /** What is loaded into A — a picked file's name, or a label for a live take. Empty when idle. */
  const sourceNameA = ref('');
  const selectionA = ref<ReferenceSelection>({ startSample: 0, endSample: 0, duration: 0 });
  const spectrumA = ref<FrequencySpectrum | null>(null);
  /** Where the transport is on A's timeline, in seconds — null when nothing is cued there. */
  const playheadA = ref<number | null>(null);

  // --- Reference tabs: up to MAX_REFERENCES, each independently computed against A. ---
  const audioAssets = ref<Record<string, AudioAsset>>({});
  const references = ref<Record<string, ReferenceState>>({});
  const referenceOrder = ref<string[]>([]);
  const activeReferenceId = ref<string | null>(null);
  /** The reference whose asset is currently sounding (mode 'reference') or whose IR is
   * being convolved against A (mode 'processed') — null while nothing is playing or while
   * mode is 'original'. Used to know whether removing a tab must stop playback first. */
  let playingReferenceId: string | null = null;
  const fftConfig = ref<FFTConfig>({ ...DEFAULT_FFT_CONFIG });
  const playbackState = ref<'idle' | 'playing' | 'paused'>('idle');
  const isAutoComputing = ref(false);
  /** Which take the live recording is going into, null when idle — drives the in-slot Stop
   * button and disables every other Record button while it's non-null. 'A', or a specific
   * reference tab (any tab, empty or already filled, can be re-recorded into). */
  const recordingTarget = ref<RecordTarget | null>(null);
  /** DevicePicker.vue writes these; WaveformEditor.vue reads them to set the selected
   * device's MediaStream and channel on its own <Waver> before the user presses Record. */
  const selectedInputDeviceId = ref('');
  const selectedChannelIndex = ref(0);
  let audioContext: AudioContext | null = null;
  let convolverNode: ConvolverNode | null = null;
  let gainNode: GainNode | null = null;
  /**
   * Last measured headroom trim, keyed by the exact IR and audio it was measured on.
   * Both are replaced wholesale whenever anything upstream changes, so identity is a
   * complete invalidation test. A single slot is enough even with several references'
   * IRs cycling through it: switching which one plays swaps the cached `ir` identity too.
   */
  let trimCache: { ir: ImpulseResponse; source: Float32Array; trim: number } | null = null;
  /** The IR re-rendered at the context's rate, when the two disagree. Keyed the same way. */
  let contextIR: { source: ImpulseResponse; rate: number; rendered: ImpulseResponse } | null = null;
  /**
   * Live FFT tap on whatever is currently sounding, one node per channel, exposed so the
   * spectrum plot can draw the moving curve. Empty when nothing is sounding. shallowRef:
   * an AudioNode behind a reactive proxy breaks the native methods, and the array is
   * replaced wholesale on every start/stop anyway.
   */
  const analysers = shallowRef<AnalyserNode[]>([]);
  /** Which of the three sources the analyser is currently tapping — null when idle. */
  const playbackSource = ref<PlaybackMode | null>(null);
  /** Source node for the analysers, so they can be swapped on FFT size changes mid-playback. */
  let analyserTap: AudioNode | null = null;
  /** Splitter feeding one analyser per channel — null while a mono source is sounding. */
  let analyserSplitter: ChannelSplitterNode | null = null;
  /** Channels the tap carries, remembered so an FFT size change can rebuild the same fan-out. */
  let analyserChannelCount = 1;
  /**
   * Every source that has been started and not yet stopped. A single reference is not
   * enough: two starts that overlap (rapid mode switching, a seek landing while the
   * previous start is still awaiting the context) would overwrite it and leave the
   * first source sounding with nothing left pointing at it — audible and unstoppable.
   */
  const liveSources = new Set<AudioBufferSourceNode>();
  /** Bumped by every start and every stop, so a start that lost the race can bail out. */
  let playbackGeneration = 0;
  const playbackVolume = ref(0.8);
  const liveFFTSize = ref(4096);

  // ---------------------------------------------------------------------------------
  // Small internal helpers
  // ---------------------------------------------------------------------------------

  /** Disambiguates a new tab's label against every currently open tab, "kick.wav (2)" style. */
  function disambiguateLabel(name: string): string {
    const existing = new Set(Object.values(references.value).map((r) => r.label));
    if (!existing.has(name)) return name;
    let n = 2;
    while (existing.has(`${name} (${n})`)) n++;
    return `${name} (${n})`;
  }

  function cloneGraphicEqState(state: GraphicEqState): GraphicEqState {
    return { enabled: state.enabled, bands: state.bands.map((b) => ({ ...b })) };
  }

  /**
   * What playback/analysis reads for a given target: A's flat refs, or a reference tab's
   * asset. The one seam every rate/channel-reading function below goes through instead of
   * indexing a `{A,B}` record.
   */
  function resolveAudioSource(target: AudioTarget): {
    buffer: Float32Array;
    channels: Float32Array[];
    sampleRate: number;
    header: WavHeader | null;
  } | null {
    if (target === 'A') {
      return {
        buffer: audioBufferA.value,
        channels: channelBufferA.value,
        sampleRate: sampleRateA.value,
        header: audioHeaderA.value,
      };
    }
    const ref = references.value[target.referenceId];
    if (!ref || !ref.assetId) return null;
    const asset = audioAssets.value[ref.assetId];
    if (!asset) return null;
    return {
      buffer: asset.buffer,
      channels: asset.channels,
      sampleRate: asset.sampleRate,
      header: asset.header,
    };
  }

  /**
   * The selected part of a source, one array per original channel — no gain applied.
   * (Normalization used to scale this; it was dead code — see `git show 2922146` — and is
   * gone along with `normalized`/`normalizeGains`.)
   *
   * Analysis reads the channels rather than the mono mix so inter-channel phase cannot
   * cancel into the magnitude spectrum (see `channelPower` in fftProcessor). Falls back to
   * the mono buffer for anything loaded before channels existed.
   */
  function selectedChannels(
    source: { buffer: Float32Array; channels: Float32Array[] },
    selection: { startSample: number; endSample: number },
  ): Float32Array[] {
    const sources = source.channels.length ? source.channels : [source.buffer];
    return sources.map((channel) => channel.slice(selection.startSample, selection.endSample));
  }

  /**
   * A Welch average over a couple of frames of one transient is not a tone. Reject
   * selections that cannot support a meaningful average rather than quietly turning
   * them into an IR.
   */
  function assertLongEnough(
    label: string,
    signal: Float32Array,
    config: FFTConfig,
    sampleRate: number,
  ): void {
    const minSamples = Math.max(config.fftSize * 2, Math.round(sampleRate * MIN_ANALYSIS_SECONDS));
    if (signal.length < minSamples) {
      throw new Error(
        `Selection ${label} too short: ${(signal.length / sampleRate).toFixed(2)} s, ` +
          `need at least ${(minSamples / sampleRate).toFixed(2)} s for a stable spectrum`,
      );
    }
  }

  /** The IR that's live right now — the active reference's, or null if nothing is active
   * or it hasn't been derived yet. 'processed' playback always uses this. */
  function currentIR(): ImpulseResponse | null {
    const id = activeReferenceId.value;
    return id ? references.value[id]?.ir ?? null : null;
  }

  /**
   * `toneCurve` with the graphic EQ folded in, when it's on — the one seam every render
   * site goes through. Kept as a function rather than a computed: it takes a sample rate
   * (export can render at a rate other than the live one) and callers need the `null`
   * case anyway when there's nothing to render yet.
   */
  function curveToRenderFor(ref: ReferenceState, sampleRate: number): ToneCurve | null {
    if (!ref.toneCurve) return null;
    return applyGraphicEq(ref.toneCurve, ref.graphicEq, sampleRate);
  }

  // ---------------------------------------------------------------------------------
  // A: load / record / clear
  // ---------------------------------------------------------------------------------

  /**
   * Spectrum for A right after it got new audio, from a file or from a take. The
   * spectrumA watch below chains the reference IR recompute off this, so skipping it
   * leaves both the spectrum and every reference's IR stale.
   */
  async function autoComputeSpectrumA(): Promise<void> {
    if (isAutoComputing.value) return;

    isAutoComputing.value = true;
    try {
      await computeSpectrumA(fftConfig.value);
      logger.debug('analysisStore', 'Spectrum auto-computed for A');
    } catch (error) {
      reportError('Auto-compute failed for A', error, "Couldn't analyze the working wave — try loading the file again.");
    } finally {
      isAutoComputing.value = false;
    }
  }

  async function finishRecordingIntoA(audioData: Float32Array, sampleRate: number): Promise<void> {
    audioBufferA.value = audioData;
    // The recorder picks a single input channel rather than summing, so a take is already
    // mono and there is nothing to deinterleave.
    channelBufferA.value = [audioData];
    audioHeaderA.value = { sampleRate, channels: 1, bitDepth: 32, duration: audioData.length / sampleRate };
    sampleRateA.value = sampleRate;
    sourceNameA.value = 'Live take';

    selectionA.value = {
      startSample: 0,
      endSample: audioData.length,
      duration: audioHeaderA.value.duration * 1000,
    };

    logger.info('analysisStore', 'Recording saved', {
      samples: audioData.length,
      sampleRate,
    });

    await autoComputeSpectrumA();
  }

  /**
   * The reference could have been removed mid-take (tab closed while recording into it) —
   * the recorder still has to be stopped cleanly (done by the caller, `stopRecording`,
   * before this runs), but there is no tab left to write the take into, so it's dropped.
   */
  async function finishRecordingIntoReference(referenceId: string, audioData: Float32Array, sampleRate: number): Promise<void> {
    const ref = references.value[referenceId];
    if (!ref) {
      logger.warn('analysisStore', 'Recording target reference no longer exists, discarding take', {
        referenceId,
      });
      return;
    }

    const header: WavHeader = { sampleRate, channels: 1, bitDepth: 32, duration: audioData.length / sampleRate };
    const assetId = generateId('asset');
    const label = disambiguateLabel('Live take');
    audioAssets.value[assetId] = {
      id: assetId,
      buffer: audioData,
      channels: [audioData],
      sampleRate,
      header,
      sourceName: label,
    };

    ref.assetId = assetId;
    ref.selection = { startSample: 0, endSample: audioData.length, duration: header.duration * 1000 };
    ref.label = label;
    ref.stale = true;

    logger.info('analysisStore', 'Recording saved into reference', {
      referenceId,
      assetId,
      samples: audioData.length,
    });

    // Mirrors addReference targeting an existing empty ref: only worth eagerly computing
    // if this is the tab actually on screen.
    if (referenceId === activeReferenceId.value) {
      try {
        await recomputeReference(referenceId);
      } catch (error) {
        reportError('Recompute after recording into reference failed', error, "Couldn't analyze the new recording.");
      }
    }
  }

  /** Averages deinterleaved channels down to mono — same formula audioDecoder.ts/wavParser.ts
   * use for file-parsed audio, applied here to whatever waver's own Load button decoded. */
  function mixToMono(channels: Float32Array[]): Float32Array {
    if (channels.length <= 1) return channels[0] ?? new Float32Array();
    const mixed = new Float32Array(channels[0].length);
    for (const channel of channels) {
      for (let i = 0; i < mixed.length; i++) mixed[i] += channel[i] / channels.length;
    }
    return mixed;
  }

  /**
   * Called from WaveformEditor's `@loadsuccess` on waver's own built-in Load button —
   * `channels` is waver's `getChannels()` (empty for a mono source; use `samples` then).
   * Mirrors `finishRecordingIntoA` but keeps the picked file's name and real channel data
   * instead of collapsing to a synthetic mono "take".
   */
  async function finishLoadIntoA(fileName: string, samples: Float32Array, channels: Float32Array[], sampleRate: number): Promise<void> {
    const channelBuffer = channels.length > 0 ? channels : [samples];
    audioBufferA.value = mixToMono(channelBuffer);
    channelBufferA.value = channelBuffer;
    audioHeaderA.value = { sampleRate, channels: channelBuffer.length, bitDepth: 32, duration: samples.length / sampleRate };
    sampleRateA.value = sampleRate;
    sourceNameA.value = fileName;

    selectionA.value = {
      startSample: 0,
      endSample: samples.length,
      duration: audioHeaderA.value.duration * 1000,
    };

    logger.info('analysisStore', 'File A loaded via waver Load button', {
      samples: samples.length,
      sampleRate,
      channels: channelBuffer.length,
    });

    await autoComputeSpectrumA();
  }

  /** Same as `finishLoadIntoA`, into a reference tab. Mirrors `finishRecordingIntoReference`. */
  async function finishLoadIntoReference(referenceId: string, fileName: string, samples: Float32Array, channels: Float32Array[], sampleRate: number): Promise<void> {
    const ref = references.value[referenceId];
    if (!ref) {
      logger.warn('analysisStore', 'Load target reference no longer exists, discarding file', { referenceId });
      return;
    }

    const channelBuffer = channels.length > 0 ? channels : [samples];
    const header: WavHeader = { sampleRate, channels: channelBuffer.length, bitDepth: 32, duration: samples.length / sampleRate };
    const assetId = generateId('asset');
    const label = disambiguateLabel(fileName);
    audioAssets.value[assetId] = {
      id: assetId,
      buffer: mixToMono(channelBuffer),
      channels: channelBuffer,
      sampleRate,
      header,
      sourceName: label,
    };

    ref.assetId = assetId;
    ref.selection = { startSample: 0, endSample: samples.length, duration: header.duration * 1000 };
    ref.label = label;
    ref.stale = true;

    logger.info('analysisStore', 'File loaded into reference via waver Load button', {
      referenceId,
      assetId,
      samples: samples.length,
    });

    if (referenceId === activeReferenceId.value) {
      try {
        await recomputeReference(referenceId);
      } catch (error) {
        reportError('Recompute after loading into reference failed', error, "Couldn't analyze the new reference.");
      }
    }
  }

  /**
   * Dropping A invalidates every reference's IR: each is a function of A's spectrum, so
   * with A gone there is nothing left to match against. Mark them all stale rather than
   * null out spectra/curves outright — the reference's own analysis is still valid, only
   * the A-dependent half needs redoing once A comes back.
   */
  function clearFile(): void {
    stopPlayback();

    audioBufferA.value = new Float32Array();
    channelBufferA.value = [];
    audioHeaderA.value = null;
    sampleRateA.value = 44100;
    sourceNameA.value = '';
    selectionA.value = { startSample: 0, endSample: 0, duration: 0 };
    spectrumA.value = null;
    playheadA.value = null;

    for (const ref of Object.values(references.value)) {
      if (ref.assetId === null) continue;
      ref.ir = null;
      ref.toneCurve = null;
      ref.stale = true;
    }

    if (activeRecomputeTimer !== null) {
      clearTimeout(activeRecomputeTimer);
      activeRecomputeTimer = null;
    }
    contextIR = null;
    trimCache = null;

    logger.info('analysisStore', 'File cleared: A', { irDiscarded: true });
  }

  /**
   * A's counterpart to `updateReferenceSelection` — Phase 1 dropped the generic
   * `updateSelection(slot, ...)` action along with the `{A,B}` record, but left nothing
   * in its place for A itself (only references got one). Added here rather than in the
   * composable layer since it's store state being mutated.
   */
  function updateSelectionA(startSample: number, endSample: number): void {
    const duration = ((endSample - startSample) / (sampleRateA.value || 44100)) * 1000;
    selectionA.value = { startSample, endSample, duration };
    logger.debug('analysisStore', 'A selection updated', {
      startSample,
      endSample,
      duration: duration.toFixed(0) + 'ms',
    });
  }

  async function computeSpectrumA(config: FFTConfig): Promise<void> {
    logger.debug('analysisStore', 'Computing spectrum A', { fftSize: config.fftSize });

    if (audioBufferA.value.length === 0) {
      throw new Error('Audio file A not loaded');
    }

    const signal = selectedChannels(
      { buffer: audioBufferA.value, channels: channelBufferA.value },
      selectionA.value,
    );
    assertLongEnough('A', signal[0], config, sampleRateA.value);

    try {
      const fftResult = computeAveragedFFT(signal, config, sampleRateA.value);
      spectrumA.value = extractSpectrum(fftResult);
      logger.debug('analysisStore', 'Spectrum A computed', {
        bins: spectrumA.value.frequencies.length,
        sampleRate: sampleRateA.value,
      });
    } catch (error) {
      logger.error('analysisStore', 'FFT computation failed for A', { error: String(error) });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------------
  // Reference tabs: add / clone / remove / activate
  // ---------------------------------------------------------------------------------

  /**
   * Creates a reference tab with no audio yet — the "+" button's tab, filled in later by
   * a load into it via waver's Load button (`finishLoadIntoReference`) or a recording
   * targeting `{referenceId: id}`. Always activates immediately: an empty tab exists
   * purely so the user can see its Load/Record buttons and fill it in, and there's
   * nothing to compute yet that would make eager activation costly the way it would for
   * a real (possibly stale) tab.
   */
  function addEmptyReference(): string {
    if (referenceOrder.value.length >= MAX_REFERENCES) {
      reportError(
        'addEmptyReference rejected',
        new Error('Max references reached'),
        `You can compare up to ${MAX_REFERENCES} references at once — remove one before adding another.`,
      );
      return '';
    }

    const id = generateId('ref');
    const label = disambiguateLabel('Empty reference');
    references.value[id] = {
      id,
      assetId: null,
      selection: { startSample: 0, endSample: 0, duration: 0 },
      spectrum: null,
      ir: null,
      toneCurve: null,
      graphicEq: createDefaultGraphicEqState(),
      toneMatchConfig: { ...DEFAULT_TONE_MATCH_CONFIG },
      playhead: null,
      label,
      stale: false,
    };
    referenceOrder.value.push(id);
    activeReferenceId.value = id;

    logger.debug('analysisStore', 'Empty reference added', { id, label });
    return id;
  }

  function cloneReference(id: string): string {
    const source = references.value[id];
    if (!source) {
      reportError('cloneReference failed', new Error(`Unknown reference ${id}`), "Couldn't clone that reference — try again.");
      return '';
    }
    if (referenceOrder.value.length >= MAX_REFERENCES) {
      reportError(
        'cloneReference rejected',
        new Error('Max references reached'),
        `You can compare up to ${MAX_REFERENCES} references at once — remove one before cloning another.`,
      );
      return '';
    }

    const newId = generateId('ref');
    const label = disambiguateLabel(source.label);
    references.value[newId] = {
      id: newId,
      assetId: source.assetId,
      // Copied, not reset — the point of a clone is "a different loop off an existing
      // one", so starting from the source's current loop is less work than dragging fresh.
      selection: { ...source.selection },
      // Never shared with the source: a clone is always computationally independent (per
      // the multi-reference plan), even before either tab's selection changes.
      spectrum: null,
      ir: null,
      toneCurve: null,
      // EQ/tone-match settings ARE copied (unlike the computed fields above) — a clone
      // is "same processing, different loop" more often than "start over", and nothing
      // in the plan calls for resetting them. Judgment call; easy to flip if wrong.
      graphicEq: cloneGraphicEqState(source.graphicEq),
      toneMatchConfig: { ...source.toneMatchConfig },
      playhead: null,
      label,
      stale: true,
    };

    const sourceIdx = referenceOrder.value.indexOf(id);
    referenceOrder.value.splice(sourceIdx + 1, 0, newId);

    logger.debug('analysisStore', 'Reference cloned', { sourceId: id, newId, assetId: source.assetId });
    return newId;
  }

  function removeReference(id: string): void {
    const ref = references.value[id];
    if (!ref) return;

    if (playingReferenceId === id) {
      stopPlayback();
    }

    const idx = referenceOrder.value.indexOf(id);
    delete references.value[id];
    if (idx !== -1) referenceOrder.value.splice(idx, 1);

    // Nothing to GC for an empty reference — it never had an asset.
    const assetId = ref.assetId;
    const stillReferenced = assetId
      ? Object.values(references.value).some((r) => r.assetId === assetId)
      : false;
    if (assetId && !stillReferenced) delete audioAssets.value[assetId];

    if (activeReferenceId.value === id) {
      const sibling = referenceOrder.value[idx] ?? referenceOrder.value[idx - 1] ?? null;
      activeReferenceId.value = null;
      if (sibling) setActiveReference(sibling);
    }

    logger.debug('analysisStore', 'Reference removed', {
      id,
      assetGCed: !!assetId && !stillReferenced,
      newActive: activeReferenceId.value,
    });
  }

  /**
   * Runs the full recompute chain (spectrum -> tone curve -> IR) for one reference and
   * clears its `stale` flag on success. Left un-exported: callers reach it only through
   * `setActiveReference` (immediate) or the debounced paths below (`scheduleActiveRecompute`).
   */
  async function recomputeReference(id: string): Promise<void> {
    const ref = references.value[id];
    // Empty (assetId === null) — a "+"-created placeholder, or one whose take/file was
    // removed. Nothing to analyze yet; `stale` doesn't apply until it's filled in, so this
    // is a no-op rather than a failed compute (see the spectrumA watch below, which must
    // not mark an empty tab stale in the first place, but this guard covers every other
    // path into recomputeReference too — e.g. a tab that had audio removed mid-flight).
    if (!ref || ref.assetId === null) return;
    await computeReferenceSpectrum(id, fftConfig.value);
    // A may not be loaded yet (e.g. a reference tab loaded/edited before A). Tone-match IR
    // needs spectrumA; without it there's nothing to derive yet, so leave `stale` set and
    // let the spectrumA watch pick this reference up once A lands, rather than throwing on
    // every selection change in the meantime.
    if (!spectrumA.value) return;
    await computeReferenceToneMatchIR(id, ref.toneMatchConfig);
    ref.stale = false;
  }

  let activeRecomputeTimer: number | null = null;
  function scheduleActiveRecompute(): void {
    const id = activeReferenceId.value;
    if (!id) return;
    if (activeRecomputeTimer !== null) clearTimeout(activeRecomputeTimer);
    activeRecomputeTimer = window.setTimeout(async () => {
      activeRecomputeTimer = null;
      try {
        await recomputeReference(id);
      } catch (error) {
        reportError('Active reference recompute failed', error, "Couldn't refresh that reference.");
      }
    }, 100);
  }

  /**
   * Selects a reference tab. If it's stale, the recompute chain runs first and the tab
   * only becomes active once it lands — avoids a flash of the previous tab's stale data
   * under the new label. On a failed recompute the tab still activates (so it's not stuck
   * unselectable), just with whatever data it had before.
   */
  function setActiveReference(id: string | null): void {
    if (id === null) {
      activeReferenceId.value = null;
      return;
    }
    const ref = references.value[id];
    if (!ref) {
      logger.warn('analysisStore', 'setActiveReference: unknown reference', { id });
      return;
    }
    if (!ref.stale) {
      activeReferenceId.value = id;
      return;
    }
    recomputeReference(id)
      .then(() => {
        activeReferenceId.value = id;
      })
      .catch((error) => {
        reportError('setActiveReference recompute failed', error, "Couldn't refresh that reference — try again.");
        activeReferenceId.value = id;
      });
  }

  function updateReferenceSelection(id: string, startSample: number, endSample: number): void {
    const ref = references.value[id];
    if (!ref) return;
    const asset = ref.assetId ? audioAssets.value[ref.assetId] : undefined;
    const sampleRate = asset?.sampleRate || 44100;
    const duration = ((endSample - startSample) / sampleRate) * 1000;

    ref.selection = { startSample, endSample, duration };
    ref.stale = true;
    logger.debug('analysisStore', `Reference selection updated: ${id}`, {
      startSample,
      endSample,
      duration: duration.toFixed(0) + 'ms',
    });

    if (id === activeReferenceId.value) scheduleActiveRecompute();
  }

  async function computeReferenceSpectrum(id: string, config: FFTConfig): Promise<void> {
    const ref = references.value[id];
    if (!ref) throw new Error(`Unknown reference ${id}`);
    const asset = ref.assetId ? audioAssets.value[ref.assetId] : undefined;
    if (!asset || asset.buffer.length === 0) throw new Error(`Reference ${id} has no audio loaded`);

    logger.debug('analysisStore', 'Computing reference spectrum', { id, fftSize: config.fftSize });

    const signal = selectedChannels(asset, ref.selection);
    assertLongEnough(ref.label, signal[0], config, asset.sampleRate);

    try {
      const fftResult = computeAveragedFFT(signal, config, asset.sampleRate);
      ref.spectrum = extractSpectrum(fftResult);
      logger.debug('analysisStore', `Spectrum computed for reference ${id}`, {
        bins: ref.spectrum.frequencies.length,
        sampleRate: asset.sampleRate,
      });
    } catch (error) {
      logger.error('analysisStore', `FFT computation failed for reference ${id}`, { error: String(error) });
      throw error;
    }
  }

  /**
   * Tone-match IR: load A and it takes on this reference's tone. A is the working
   * sound, the reference is the target.
   *
   * The IR is rendered at A's sample rate, since that is what it will be played at. The
   * reference's spectrum is resampled onto A's frequency grid inside `deriveToneCurve`,
   * so the two files need not share a rate.
   */
  async function computeReferenceToneMatchIR(id: string, config?: ToneMatchConfig): Promise<void> {
    const ref = references.value[id];
    if (!ref) throw new Error(`Unknown reference ${id}`);
    if (!spectrumA.value || !ref.spectrum) {
      throw new Error('Both spectra must be computed before deriving a tone-match IR');
    }

    ref.toneMatchConfig = { ...ref.toneMatchConfig, ...config };
    ref.toneCurve = deriveToneCurve(spectrumA.value, ref.spectrum, sampleRateA.value, ref.toneMatchConfig);
    ref.ir = renderToneMatchIR(
      curveToRenderFor(ref, sampleRateA.value)!,
      sampleRateA.value,
      ref.toneMatchConfig.taps!,
    );

    logger.debug('analysisStore', `Tone-match IR computed for reference ${id}`, {
      taps: ref.ir.length,
      sampleRate: ref.ir.sampleRate,
    });

    // Only the active tab could possibly be sounding through the live convolver.
    if (id === activeReferenceId.value) refreshLiveConvolver();
  }

  /**
   * Re-render a reference's cached curve at another rate or length. Cheap — one cepstrum
   * FFT, no re-analysis. This is the export path (including bulk IR download, Phase 5).
   */
  function renderReferenceIRAt(id: string, sampleRate: number, taps: number): ImpulseResponse | null {
    const ref = references.value[id];
    if (!ref) return null;
    const curve = curveToRenderFor(ref, sampleRate);
    if (!curve) return null;
    return renderToneMatchIR(curve, sampleRate, taps);
  }

  function setReferenceIRTaps(id: string, taps: number): void {
    const ref = references.value[id];
    if (!ref || !ref.toneCurve) return;
    ref.toneMatchConfig = { ...ref.toneMatchConfig, taps };
    ref.ir = renderToneMatchIR(curveToRenderFor(ref, sampleRateA.value)!, sampleRateA.value, taps);
    if (id === activeReferenceId.value) refreshLiveConvolver();
  }

  /** Re-bakes a reference's IR from its current curve + graphic EQ and hot-swaps the live
   * convolver if that reference is the one sounding. */
  function rerenderReferenceIR(id: string): void {
    const ref = references.value[id];
    if (!ref || !ref.toneCurve) return;
    ref.ir = renderToneMatchIR(
      curveToRenderFor(ref, sampleRateA.value)!,
      sampleRateA.value,
      ref.toneMatchConfig.taps!,
    );
    if (id === activeReferenceId.value) refreshLiveConvolver();
  }

  function setReferenceGraphicEqEnabled(id: string, enabled: boolean): void {
    const ref = references.value[id];
    if (!ref) return;
    ref.graphicEq.enabled = enabled;
    rerenderReferenceIR(id);
  }

  const graphicEqTimers = new Map<string, number>();
  /**
   * Debounced 120ms rather than the 300ms `setToneMatchConfig` uses: this is meant to
   * feel live while dragging a handle, and the state write itself (below) is synchronous
   * and cheap — only the FFT-based minimum-phase bake needs debouncing. Timers are kept
   * per reference id (a Map, not a single variable) purely for isolation; in practice only
   * the active tab's EQ panel is ever visible to edit.
   */
  function updateReferenceGraphicEqBand(id: string, bandId: string, partial: Partial<GraphicEqBand>): void {
    const ref = references.value[id];
    if (!ref) return;
    ref.graphicEq.bands = ref.graphicEq.bands.map((b) => (b.id === bandId ? { ...b, ...partial } : b));
    if (!ref.graphicEq.enabled || !ref.toneCurve) return;

    const existing = graphicEqTimers.get(id);
    if (existing !== undefined) clearTimeout(existing);
    const timer = window.setTimeout(() => {
      graphicEqTimers.delete(id);
      rerenderReferenceIR(id);
    }, 120);
    graphicEqTimers.set(id, timer);
  }

  // A's spectrum just (re)computed — every reference's IR was derived against the old
  // one, so all become stale. Only the active tab is worth recomputing eagerly; the rest
  // wait until they're selected (see `setActiveReference`). Debounced so a burst of
  // spectrum updates (e.g. dragging A's selection) coalesces into one recompute.
  watch(spectrumA, (value) => {
    if (!value) return;
    // Empty tabs have nothing derived from A to go stale — marking one anyway just sets up
    // a doomed recompute the moment it's active (computeReferenceSpectrum has no audio to
    // read), surfacing as a spurious "Couldn't refresh that reference" toast on every A edit.
    for (const ref of Object.values(references.value)) {
      if (ref.assetId !== null) ref.stale = true;
    }
    const id = activeReferenceId.value;
    if (id && references.value[id]?.stale) scheduleActiveRecompute();
  });

  // Hot-swap analyser when FFT size changes mid-playback
  watch(liveFFTSize, () => {
    if (analysers.value.length) createLiveAnalyser();
  });

  // ---------------------------------------------------------------------------------
  // Active-reference-scoped setters
  //
  // These four keep today's names (`setToneMatchConfig`, `setFFTConfig`,
  // `setGraphicEqEnabled`, `updateGraphicEqBand`) rather than renaming to something like
  // `setActiveToneMatchConfig` — later-phase components already call these names, and
  // "act on whichever reference is active" is the natural reading once there is only ever
  // one reference showing its controls at a time. They no-op (with a log) when nothing is
  // active. `setFFTConfig` is the one exception that isn't purely active-scoped: `fftConfig`
  // itself is still global (both A and every reference use the same FFT settings), so it
  // recomputes A's spectrum too, mirroring today's "compute both" behavior.
  // ---------------------------------------------------------------------------------

  let setToneMatchTimer: number | null = null;

  function setToneMatchConfig(partial: Partial<ToneMatchConfig>): void {
    const id = activeReferenceId.value;
    if (!id) {
      logger.warn('analysisStore', 'setToneMatchConfig: no active reference');
      return;
    }
    const ref = references.value[id];
    if (!ref) return;
    ref.toneMatchConfig = { ...ref.toneMatchConfig, ...partial };
    if (!ref.toneCurve) return;
    if (setToneMatchTimer !== null) clearTimeout(setToneMatchTimer);
    setToneMatchTimer = window.setTimeout(async () => {
      setToneMatchTimer = null;
      try {
        await computeReferenceToneMatchIR(id, ref.toneMatchConfig);
      } catch (error) {
        reportError('setToneMatchConfig recompute failed', error, "Couldn't update the impulse response with the new settings.");
      }
    }, 300);
  }

  let setFFTTimer: number | null = null;

  function setFFTConfig(partial: Partial<FFTConfig>): void {
    fftConfig.value = { ...fftConfig.value, ...partial };
    if (setFFTTimer !== null) clearTimeout(setFFTTimer);
    setFFTTimer = window.setTimeout(async () => {
      setFFTTimer = null;
      try {
        if (spectrumA.value) await computeSpectrumA(fftConfig.value);
        const id = activeReferenceId.value;
        if (id && references.value[id]?.spectrum) await computeReferenceSpectrum(id, fftConfig.value);
      } catch (error) {
        reportError('setFFTConfig recompute failed', error, "Couldn't recompute the spectrum with the new FFT settings.");
      }
    }, 300);
  }

  function setGraphicEqEnabled(enabled: boolean): void {
    const id = activeReferenceId.value;
    if (!id) {
      logger.warn('analysisStore', 'setGraphicEqEnabled: no active reference');
      return;
    }
    setReferenceGraphicEqEnabled(id, enabled);
  }

  function updateGraphicEqBand(bandId: string, partial: Partial<GraphicEqBand>): void {
    const id = activeReferenceId.value;
    if (!id) {
      logger.warn('analysisStore', 'updateGraphicEqBand: no active reference');
      return;
    }
    updateReferenceGraphicEqBand(id, bandId, partial);
  }

  // ---------------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------------

  // Playback is already routed through convolverNode — hot-swap its buffer so a
  // live selection/config change is heard immediately, no restart needed.
  function refreshLiveConvolver(): void {
    if (!convolverNode || !audioContext) return;
    const response = currentIR();
    if (!response) return;

    convolverNode.buffer = buildIRBuffer(audioContext, irAtContextRate(audioContext)!);
    // A new IR means new headroom, so the trim baked into the running
    // gain is stale — re-apply it at the current volume rather than waiting for a restart
    setVolume(playbackVolume.value);
    logger.debug('analysisStore', 'Live convolver buffer refreshed');
  }

  /**
   * Level both playback paths have to give up so the filter cannot clip.
   * Same value dry or wet, so switching modes compares tone and not loudness.
   *
   * Measured, not bounded: this take through this filter, peak-read off the result. See
   * `measureHeadroomTrim` for why the L1 bound and not `max|H(f)|` is what's used when
   * there's no audio to measure against.
   */
  function headroomTrim(): number {
    const response = currentIR();
    if (!response) return 1;

    const source = audioBufferA.value;
    if (source.length === 0) return boundedTrim(response);

    if (trimCache && trimCache.ir === response && trimCache.source === source) {
      return trimCache.trim;
    }

    const trim = measureTrim(response);
    trimCache = { ir: response, source, trim };
    return trim;
  }

  /** No audio to measure against — fall back to the worst-case bounds. */
  function boundedTrim(response: ImpulseResponse): number {
    const l1 = response.l1Norm;
    if (l1 === undefined) {
      const boostDb = response.maxGainDb ?? 0;
      return boostDb > 0 ? Math.pow(10, -boostDb / 20) : 1;
    }
    return l1 > 1 ? 1 / l1 : 1;
  }

  function measureTrim(response: ImpulseResponse): number {
    const started = performance.now();
    const measurement = measureHeadroomTrim(
      response.coefficients,
      playbackChannels('A'),
      sampleRateA.value || 44100,
    );

    logger.debug('analysisStore', 'Headroom measured', {
      wetPeak: measurement.peak.toFixed(3),
      trimDb: (20 * Math.log10(measurement.trim)).toFixed(2),
      boundedTrimDb: (20 * Math.log10(boundedTrim(response))).toFixed(2),
      scannedSamples: measurement.scanned,
      ms: (performance.now() - started).toFixed(0),
    });

    return measurement.trim;
  }

  function buildIRBuffer(context: AudioContext, response: ImpulseResponse): globalThis.AudioBuffer {
    const buffer = context.createBuffer(1, response.coefficients.length, response.sampleRate);
    buffer.getChannelData(0).set(response.coefficients);
    return buffer;
  }

  /**
   * The rate everything sounds at. Pinned to the working take: that is what the IR is
   * rendered for, and a reference is a different file on its own timeline anyway, so
   * letting its source node resample it costs nothing tonally.
   */
  function playbackRate(target: AudioTarget): number {
    if (audioBufferA.value.length > 0) return sampleRateA.value || 44100;
    const resolved = resolveAudioSource(target);
    return resolved?.header?.sampleRate || resolved?.sampleRate || 44100;
  }

  /**
   * The context, rebuilt if the rate it was created at is no longer the working rate.
   *
   * It used to be created once and kept forever, so loading a 48 kHz file after the
   * context had been opened at 44.1 kHz left the convolver resampling the IR — the whole
   * correction curve shifted by the rate ratio, 8.8% or about an eighth of an octave,
   * with the top end blunted on the way through. The audible result is a match that is
   * nearly right and never lands.
   */
  function ensureContext(rate: number): AudioContext {
    if (audioContext && Math.abs(audioContext.sampleRate - rate) >= 1) {
      const stale = audioContext;
      audioContext = null;
      contextIR = null;
      logger.debug('analysisStore', 'Rebuilding audio context for a new rate', {
        was: stale.sampleRate,
        now: rate,
      });
      void stale.close().catch((error) => {
        logger.debug('analysisStore', 'Stale context close failed', { error: String(error) });
      });
    }

    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: rate,
      });
    }

    return audioContext!;
  }

  /**
   * The active reference's IR as the convolver must receive it: at the context's own
   * rate, re-rendered from the tone curve rather than resampled. Browsers are free to
   * ignore the rate a context was asked for, so this is checked against what the context
   * actually reports.
   */
  function irAtContextRate(context: AudioContext): ImpulseResponse | null {
    const response = currentIR();
    if (!response) return null;
    if (Math.abs(response.sampleRate - context.sampleRate) < 1) return response;

    if (contextIR && contextIR.source === response && contextIR.rate === context.sampleRate) {
      return contextIR.rendered;
    }

    const id = activeReferenceId.value;
    const taps = (id && references.value[id]?.toneMatchConfig.taps) || DEFAULT_TONE_MATCH_CONFIG.taps!;
    const rendered = id ? renderReferenceIRAt(id, context.sampleRate, taps) : null;
    if (!rendered) {
      logger.warn('analysisStore', 'No tone curve to re-render the IR at the context rate', {
        irRate: response.sampleRate,
        contextRate: context.sampleRate,
      });
      return response;
    }

    contextIR = { source: response, rate: context.sampleRate, rendered };
    logger.debug('analysisStore', 'IR re-rendered at the context rate', {
      from: response.sampleRate,
      to: context.sampleRate,
    });
    return rendered;
  }

  /**
   * What playback feeds the graph: the take's own channels, not the mono mixdown.
   *
   * Analysis reads the channels and sums them incoherently, precisely so inter-channel
   * phase cannot cancel into the measured spectrum. Playing `(L+R)/2` undid that at the
   * last step — the signal reaching the ears carried comb notches and up to 3 dB of loss
   * in every decorrelated band that the analysis had never seen, so the correction was
   * derived for a signal nobody was listening to. Feeding the channels through instead
   * makes the played signal the measured one. A mono response convolves each channel
   * separately, which is exactly the per-channel correction that was derived.
   */
  function playbackChannels(target: AudioTarget): Float32Array[] {
    const resolved = resolveAudioSource(target);
    if (!resolved) return [];
    // More than stereo would be downmixed by the destination anyway, and the mixdown is
    // at least a known quantity
    if (resolved.channels.length === 0 || resolved.channels.length > 2) return [resolved.buffer];
    return resolved.channels;
  }

  /** Volume while sounding — the gain node stays in the graph for the whole take. */
  function setVolume(volume: number): void {
    playbackVolume.value = Math.max(0, Math.min(1, volume));
    if (!gainNode || !audioContext) return;
    // Ramped: stepping the gain on a sounding buffer clicks
    gainNode.gain.setTargetAtTime(gainFor(playbackVolume.value), audioContext.currentTime, 0.01);
  }

  /**
   * Slider position to linear gain. Squared because a linear fader spends almost all of
   * its travel in the loud region — half way reads as barely quieter, and the control
   * feels broken until it is nearly at zero. Squaring is close enough to the loudness
   * curve for a monitoring fader, and the headroom trim rides on top unchanged.
   */
  function gainFor(volume: number): number {
    const level = Math.max(0, Math.min(1, volume));
    return level * level * headroomTrim();
  }

  /**
   * Three things you can listen to: A dry ('original'), A through the active
   * reference's derived filter ('processed'), or a reference's own audio ('reference' —
   * defaults to the active tab, or an explicit `referenceId`).
   */
  async function playback(
    volume: number,
    mode: PlaybackMode = 'processed',
    offset = 0,
    loop = false,
    loopStartSeconds?: number,
    loopEndSeconds?: number,
    referenceId?: string,
  ): Promise<void> {
    const targetReferenceId = mode === 'reference' ? referenceId ?? activeReferenceId.value : null;
    const target: AudioTarget = mode === 'reference' ? { referenceId: targetReferenceId ?? '' } : 'A';

    if (mode === 'reference' && !targetReferenceId) {
      throw new Error('No reference selected to play');
    }

    const resolved = resolveAudioSource(target);
    const useIR = mode === 'processed';
    const irResponse = useIR ? currentIR() : null;

    logger.debug('analysisStore', 'Starting playback', {
      volume,
      mode,
      samples: resolved?.buffer.length ?? 0,
      offset,
      loop,
      loopStartSeconds,
      loopEndSeconds,
      referenceId: targetReferenceId,
    });

    // Unconditional, even when the caller already stopped: two sources sounding at once
    // is the one failure the transport cannot recover from, so never rely on the caller
    stopPlayback();
    const generation = ++playbackGeneration;
    playbackVolume.value = Math.max(0, Math.min(1, volume));

    if (!resolved || resolved.buffer.length === 0) {
      throw new Error(
        mode === 'reference' ? `No audio to play for reference ${targetReferenceId}` : 'No audio to play in slot A',
      );
    }
    if (useIR && !irResponse) {
      throw new Error('IR must be computed before playing the processed signal');
    }

    const targetRate = resolved.header?.sampleRate || resolved.sampleRate || 44100;
    const startOffset = Math.max(0, Math.min(offset, resolved.buffer.length / targetRate));

    const context = ensureContext(playbackRate(target));
    audioContext = context;

    // A context built outside a user gesture starts suspended: start() would schedule
    // silently and the transport would run with nothing audible
    if (context.state === 'suspended') {
      await context.resume();
      // A stop or a newer start happened while we were waiting — that one owns the output
      if (generation !== playbackGeneration) return;
    }

    // The take's own channels. The buffer keeps the target's rate even when the context
    // runs at another one — the source node resamples it, which is a resample of program
    // material and not of a filter.
    const channels = playbackChannels(target);
    const buffer = context.createBuffer(channels.length, channels[0].length, targetRate);
    for (let ch = 0; ch < channels.length; ch++) {
      buffer.getChannelData(ch).set(channels[ch]);
    }

    // Static headroom trim, measured off this take through this filter, applied to BOTH
    // paths so a mode switch compares tone and not loudness.
    //
    // A compressor here would be worse than the clipping it prevents: it pumps on every
    // transient, its 3 ms attack smears attacks, WebAudio's DynamicsCompressorNode adds
    // several ms of latency, and putting it in the wet path only makes the A/B unfair on
    // top of that. A constant scalar costs nothing but level, changes no tone, and keeps
    // every mode directly comparable.
    gainNode = context.createGain();
    gainNode.gain.value = gainFor(playbackVolume.value);

    const bufferSource = context.createBufferSource();
    bufferSource.buffer = buffer;

    // Native loop support is sample-accurate and gapless — no JS timer can match that.
    // The first lap starts at startOffset (allowing a paused loop to resume mid-range),
    // but every subsequent lap wraps to loopStart, ensuring the loop cycles the same
    // bounds regardless of where playback began.
    if (loop && loopStartSeconds !== undefined && loopEndSeconds !== undefined) {
      bufferSource.loop = true;
      bufferSource.loopStart = loopStartSeconds;
      bufferSource.loopEnd = loopEndSeconds;
    }

    if (useIR && irResponse) {
      // Convolve on the fly with the native ConvolverNode instead of precomputing
      // the whole signal — normalize:false so it doesn't rescale our matched gain.
      convolverNode = context.createConvolver();
      convolverNode.normalize = false;
      convolverNode.buffer = buildIRBuffer(context, irAtContextRate(context)!);

      bufferSource.connect(convolverNode);
      convolverNode.connect(gainNode);
    } else {
      convolverNode = null;
      bufferSource.connect(gainNode);
    }

    gainNode.connect(context.destination);

    // Tapped upstream of the gain node, so the drawn curve is the signal itself: moving
    // the volume fader must not move the spectrum. On the processed path the tap sits
    // after the convolver, so what is plotted is what is heard.
    analyserTap = convolverNode ?? bufferSource;
    analyserChannelCount = channels.length;
    createLiveAnalyser();
    playbackSource.value = mode;
    playingReferenceId = mode === 'original' ? null : targetReferenceId;

    bufferSource.onended = () => {
      liveSources.delete(bufferSource);
      bufferSource.disconnect();
      // A source that ended after a newer take started must not clear its state
      if (generation !== playbackGeneration) return;
      playbackState.value = 'idle';
      // The transport stops on its own timer, which can land a frame or two later —
      // drop the tap here so the curve does not hang on the last frame in between
      teardownAnalysers();
      playbackSource.value = null;
      playingReferenceId = null;
      logger.debug('analysisStore', 'Playback ended');
    };

    liveSources.add(bufferSource);
    bufferSource.start(0, startOffset);
    playbackState.value = 'playing';
  }

  /**
   * One analyser per channel, fed through a splitter.
   *
   * A single AnalyserNode downmixes its input to mono before transforming, which is the
   * coherent sum the offline analysis goes out of its way to avoid — the plotted curve
   * would carry comb notches the static spectra beside it never show, and the two would
   * never line up on wide material. Split first, and the consumer power-sums the channels
   * the same way `channelPower` does offline.
   */
  function createLiveAnalyser(): void {
    if (!analyserTap || !audioContext) return;

    teardownAnalysers();

    const build = (): AnalyserNode => {
      const node = audioContext!.createAnalyser();
      node.fftSize = liveFFTSize.value;
      node.smoothingTimeConstant = LIVE_ANALYSER_SMOOTHING;
      return node;
    };

    if (analyserChannelCount > 1) {
      const splitter = audioContext.createChannelSplitter(analyserChannelCount);
      analyserTap.connect(splitter);

      const nodes: AnalyserNode[] = [];
      for (let ch = 0; ch < analyserChannelCount; ch++) {
        const node = build();
        splitter.connect(node, ch);
        nodes.push(node);
      }

      analyserSplitter = splitter;
      analysers.value = nodes;
      return;
    }

    const node = build();
    analyserTap.connect(node);
    analysers.value = [node];
  }

  function teardownAnalysers(): void {
    for (const node of analysers.value) node.disconnect();
    analyserSplitter?.disconnect();
    analyserSplitter = null;
    analysers.value = [];
  }

  /** Silences everything currently sounding, including sources orphaned by a race. */
  function stopPlayback(): void {
    playbackGeneration++;

    const stopped = liveSources.size;
    for (const source of liveSources) {
      source.onended = null;
      try {
        source.stop();
      } catch (error) {
        // Already stopped or never started — nothing left to silence
        logger.debug('analysisStore', 'Source stop failed', { error: String(error) });
      }
      source.disconnect();
    }
    liveSources.clear();

    teardownAnalysers();
    analyserTap = null;
    playbackSource.value = null;
    playingReferenceId = null;
    convolverNode?.disconnect();
    convolverNode = null;
    gainNode?.disconnect();
    gainNode = null;
    playbackState.value = 'idle';

    if (stopped > 0) {
      logger.debug('analysisStore', 'Playback stopped', { sources: stopped });
    }
  }

  // A hot update swaps this module out, and with it the only reference to whatever is
  // sounding — the old source plays on with no transport able to reach it. Silence it
  // while the closure that owns it is still alive.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => stopPlayback());
  }

  return {
    // A
    audioBufferA,
    channelBufferA,
    sampleRateA,
    audioHeaderA,
    sourceNameA,
    selectionA,
    spectrumA,
    playheadA,
    // References
    audioAssets,
    references,
    referenceOrder,
    activeReferenceId,
    MAX_REFERENCES,
    // Shared
    fftConfig,
    playbackState,
    playbackVolume,
    liveFFTSize,
    playbackSource,
    analysers,
    isAutoComputing,
    lastError,
    recordingTarget,
    selectedInputDeviceId,
    selectedChannelIndex,
    // Actions
    finishRecordingIntoA,
    finishRecordingIntoReference,
    finishLoadIntoA,
    finishLoadIntoReference,
    clearFile,
    updateSelectionA,
    computeSpectrumA,
    addEmptyReference,
    cloneReference,
    removeReference,
    setActiveReference,
    updateReferenceSelection,
    computeReferenceSpectrum,
    computeReferenceToneMatchIR,
    renderReferenceIRAt,
    setReferenceIRTaps,
    setReferenceGraphicEqEnabled,
    updateReferenceGraphicEqBand,
    setToneMatchConfig,
    setFFTConfig,
    setGraphicEqEnabled,
    updateGraphicEqBand,
    playback,
    stopPlayback,
    setVolume,
  };
});

// Setup-store logic doesn't hot-reload on its own — Pinia keeps the old instance
// alive across HMR unless it's told to swap it, so edits here silently no-op
// until this is wired up (or the page gets a hard refresh).
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAnalysisStore, import.meta.hot));
}
