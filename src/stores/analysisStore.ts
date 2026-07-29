import { defineStore, acceptHMRUpdate } from 'pinia';
import { ref, shallowRef, watch } from 'vue';
import type { FrequencySpectrum, FFTConfig } from '../types/spectrum';
import type { ImpulseResponse, ToneCurve } from '../types/ir';
import type { RecorderConfig, AudioBuffer, SlotId, PlaybackMode } from '../types/audio';
import type { GraphicEqBand, GraphicEqState } from '../types/graphicEq';
import { createDefaultGraphicEqState } from '../types/graphicEq';
import { logger } from '../services/logging';
import { parseAudioFile } from '../services/audio/audioLoader';
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
import { AudioRecorder } from '../services/audio/recorder';
import { measureHeadroomTrim } from '../services/audio/headroom';

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

  const audioBuffers = ref({ A: new Float32Array(), B: new Float32Array() });
  const sourceBuffers = ref({ A: new Float32Array(), B: new Float32Array() });
  const channelBuffers = ref({ A: [] as Float32Array[], B: [] as Float32Array[] });
  const normalized = ref({ A: false, B: false });
  const normalizeGains = ref({ A: 1, B: 1 });
  const sampleRates = ref({ A: 44100, B: 44100 });
  const audioHeaders = ref({
    A: null as any,
    B: null as any,
  });
  /** What is in each slot — a picked file's name, or a label for a live take. Empty when idle. */
  const sourceNames = ref({ A: '', B: '' });
  const selections = ref({
    A: { startSample: 0, endSample: 0, duration: 0 },
    B: { startSample: 0, endSample: 0, duration: 0 },
  });
  const spectra = ref({ A: null as FrequencySpectrum | null, B: null as FrequencySpectrum | null });
  const ir = ref<ImpulseResponse | null>(null);
  /**
   * The correction as a frequency curve, kept so the filter can be re-rendered at any rate
   * or tap count without re-analysing the audio. This, not `ir`, is what the analysis
   * produced; `ir` is one rendering of it.
   */
  const toneCurve = ref<ToneCurve | null>(null);
  /**
   * Hand-editable correction layered on top of `toneCurve`, off by default. Never read
   * by `deriveToneCurve`/`computeToneMatchIR`'s derivation half — only `curveToRender`
   * (below) folds it in, and only at the point where a curve becomes a rendered IR.
   */
  const graphicEq = ref<GraphicEqState>(createDefaultGraphicEqState());
  const toneMatchConfig = ref<ToneMatchConfig>({ ...DEFAULT_TONE_MATCH_CONFIG });
  const fftConfig = ref<FFTConfig>({ ...DEFAULT_FFT_CONFIG });
  const irTaps = { get value() { return toneMatchConfig.value.taps!; } };
  const playbackState = ref<'idle' | 'playing' | 'paused'>('idle');
  /**
   * Where the transport is, in seconds, per waveform — null when nothing is cued there.
   * The transport lives in one panel and the waveforms in another, so the position has to
   * pass through here. A and B are heard on slot A's timeline, C on slot B's.
   */
  const playheads = ref({ A: null as number | null, B: null as number | null });
  const isAutoComputing = ref(false);
  const recorder = new AudioRecorder();
  /** Which slot the live take is going into, null when idle — drives the in-slot Stop button. */
  const recordingSlot = ref<SlotId | null>(null);
  let audioContext: AudioContext | null = null;
  let convolverNode: ConvolverNode | null = null;
  let gainNode: GainNode | null = null;
  /**
   * Last measured headroom trim, keyed by the exact IR and audio it was measured on.
   * Both are replaced wholesale whenever anything upstream changes, so identity is a
   * complete invalidation test.
   */
  let trimCache: { ir: ImpulseResponse; source: Float32Array; trim: number } | null = null;
  /** The IR re-rendered at the context's rate, when the two disagree. Keyed the same way. */
  let contextIR: { source: ImpulseResponse; rate: number; rendered: ImpulseResponse } | null = null;
  /** Normalization applied to the played channels, kept per slot rather than redone per start. */
  const scaledChannels = new Map<
    SlotId,
    { source: Float32Array[]; gain: number; channels: Float32Array[] }
  >();
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
  let autoIRTimer: number | null = null;
  /**
   * Every source that has been started and not yet stopped. A single reference is not
   * enough: two starts that overlap (rapid A/B switching, a seek landing while the
   * previous start is still awaiting the context) would overwrite it and leave the
   * first source sounding with nothing left pointing at it — audible and unstoppable.
   */
  const liveSources = new Set<AudioBufferSourceNode>();
  /** Bumped by every start and every stop, so a start that lost the race can bail out. */
  let playbackGeneration = 0;
  const playbackVolume = ref(0.8);
  const liveFFTSize = ref(4096);

  async function loadFile(file: File, slot: 'A' | 'B'): Promise<void> {
    logger.info('analysisStore', 'Loading file', { slot, fileName: file.name });

    const parsed: AudioBuffer = await parseAudioFile(file);
    audioBuffers.value[slot] = parsed.audioData;
    sourceBuffers.value[slot] = parsed.audioData;
    channelBuffers.value[slot] = parsed.channels;
    normalized.value[slot] = false;
    normalizeGains.value[slot] = 1;
    audioHeaders.value[slot] = parsed.header;
    sampleRates.value[slot] = parsed.header.sampleRate;
    sourceNames.value[slot] = file.name;

    // Reset selection to full range
    selections.value[slot] = {
      startSample: 0,
      endSample: parsed.audioData.length,
      duration: parsed.header.duration * 1000,
    };

    logger.info('analysisStore', `File ${slot} loaded`, {
      samples: parsed.audioData.length,
      sampleRate: parsed.header.sampleRate,
    });

    await autoComputeSpectrum(slot);
  }

  /**
   * Spectrum for a slot that just got new audio, from a file or from a take. The IR
   * watch chains off spectra, so skipping this leaves both the spectrum and the IR stale.
   */
  async function autoComputeSpectrum(slot: SlotId): Promise<void> {
    if (isAutoComputing.value) return;

    isAutoComputing.value = true;
    try {
      await computeSpectra(fftConfig.value, slot);
      logger.info('analysisStore', `Spectrum auto-computed for ${slot}`);
    } catch (error) {
      reportError(`Auto-compute failed for ${slot}`, error, `Couldn't analyze wave ${slot} — try loading the file again.`);
    } finally {
      isAutoComputing.value = false;
    }
  }

  async function recordAudio(config: RecorderConfig, slot: SlotId = 'A'): Promise<void> {
    logger.info('analysisStore', 'Starting recording', { slot });
    await recorder.start(config);
    recordingSlot.value = slot;
  }

  async function stopRecording(slot: SlotId = 'A'): Promise<void> {
    logger.info('analysisStore', 'Stopping recording', { slot });
    recordingSlot.value = null;
    const audioData = await recorder.stop();
    const sr = 44100; // Recorder uses 44100 Hz

    audioBuffers.value[slot] = audioData;
    sourceBuffers.value[slot] = audioData;
    // The recorder picks a single input channel rather than summing, so a take is already
    // mono and there is nothing to deinterleave.
    channelBuffers.value[slot] = [audioData];
    normalized.value[slot] = false;
    normalizeGains.value[slot] = 1;
    audioHeaders.value[slot] = {
      sampleRate: sr,
      channels: 1,
      bitDepth: 32,
      duration: audioData.length / sr,
    };
    sampleRates.value[slot] = sr;
    sourceNames.value[slot] = 'Live take';

    selections.value[slot] = {
      startSample: 0,
      endSample: audioData.length,
      duration: audioHeaders.value[slot]!.duration * 1000,
    };

    logger.info('analysisStore', 'Recording saved', {
      slot,
      samples: audioData.length,
      sampleRate: sr,
    });

    await autoComputeSpectrum(slot);
  }

  /**
   * Exchange the two slots wholesale — audio, headers, selections, spectra.
   *
   * The IR is directional (A matched onto B), so after a swap the old one is not just
   * stale but backwards. Drop it and let the spectra watch derive the inverse; anything
   * sounding is stopped first, since it is reading the buffer that is about to move.
   */
  function swapSlots(): void {
    if (recordingSlot.value !== null) {
      logger.warn('analysisStore', 'Swap ignored: recording in progress');
      return;
    }

    stopPlayback();

    const flip = <T>(pair: { A: T; B: T }): { A: T; B: T } => ({ A: pair.B, B: pair.A });

    audioBuffers.value = flip(audioBuffers.value);
    sourceBuffers.value = flip(sourceBuffers.value);
    channelBuffers.value = flip(channelBuffers.value);
    normalized.value = flip(normalized.value);
    normalizeGains.value = flip(normalizeGains.value);
    sampleRates.value = flip(sampleRates.value);
    audioHeaders.value = flip(audioHeaders.value);
    sourceNames.value = flip(sourceNames.value);
    selections.value = flip(selections.value);
    spectra.value = flip(spectra.value);
    playheads.value = flip(playheads.value);

    if (autoIRTimer !== null) {
      clearTimeout(autoIRTimer);
      autoIRTimer = null;
    }
    ir.value = null;

    logger.info('analysisStore', 'Slots swapped', {
      samplesA: audioBuffers.value.A.length,
      samplesB: audioBuffers.value.B.length,
    });
  }

  function updateSelection(slot: 'A' | 'B', startSample: number, endSample: number): void {
    const sampleRate = audioHeaders.value[slot]?.sampleRate || 44100;
    const duration = ((endSample - startSample) / sampleRate) * 1000;

    selections.value[slot] = { startSample, endSample, duration };
    logger.debug('analysisStore', `Selection updated: ${slot}`, {
      startSample,
      endSample,
      duration: duration.toFixed(0) + 'ms',
    });
  }


  /**
   * A Welch average over a couple of frames of one transient is not a tone. Reject
   * selections that cannot support a meaningful average rather than quietly turning
   * them into an IR.
   */
  function assertLongEnough(slot: 'A' | 'B', signal: Float32Array, config: FFTConfig): void {
    const sampleRate = sampleRates.value[slot];
    const minSamples = Math.max(config.fftSize * 2, Math.round(sampleRate * MIN_ANALYSIS_SECONDS));
    if (signal.length < minSamples) {
      throw new Error(
        `Selection ${slot} too short: ${(signal.length / sampleRate).toFixed(2)} s, ` +
          `need at least ${(minSamples / sampleRate).toFixed(2)} s for a stable spectrum`,
      );
    }
  }

  /**
   * The selected part of a slot, one array per original channel, with any normalization
   * gain applied.
   *
   * Analysis reads the channels rather than the mono mix so inter-channel phase cannot
   * cancel into the magnitude spectrum (see `channelPower` in fftProcessor). Falls back to
   * the mono buffer for anything loaded before channels existed.
   */
  function analysisChannels(slot: 'A' | 'B'): Float32Array[] {
    const { startSample, endSample } = selections.value[slot];
    const sources = channelBuffers.value[slot].length
      ? channelBuffers.value[slot]
      : [audioBuffers.value[slot]];
    const gain = normalized.value[slot] ? normalizeGains.value[slot] : 1;

    return sources.map((channel) => {
      const slice = channel.slice(startSample, endSample);
      if (gain !== 1) {
        for (let i = 0; i < slice.length; i++) slice[i] *= gain;
      }
      return slice;
    });
  }

  async function computeSpectra(config: FFTConfig, slot?: 'A' | 'B'): Promise<void> {
    logger.info('analysisStore', 'Computing spectra', { fftSize: config.fftSize, slot });

    // If slot specified, compute only that file
    if (slot) {
      const buffer = audioBuffers.value[slot];
      if (buffer.length === 0) {
        throw new Error(`Audio file ${slot} not loaded`);
      }

      const signal = analysisChannels(slot);

      assertLongEnough(slot, signal[0], config);

      try {
        const fftResult = computeAveragedFFT(signal, config, sampleRates.value[slot]);
        spectra.value[slot] = extractSpectrum(fftResult);
        logger.info('analysisStore', `Spectrum ${slot} computed`, {
          bins: spectra.value[slot]?.frequencies.length,
          sampleRate: sampleRates.value[slot],
        });
      } catch (error) {
        logger.error('analysisStore', `FFT computation failed for ${slot}`, { error: String(error) });
        throw error;
      }
      return;
    }

    // Compute both files
    if (audioBuffers.value.A.length === 0 || audioBuffers.value.B.length === 0) {
      throw new Error('Both audio files must be loaded before computing spectra');
    }

    const signalA = analysisChannels('A');
    const signalB = analysisChannels('B');

    assertLongEnough('A', signalA[0], config);
    assertLongEnough('B', signalB[0], config);

    try {
      const fftResultA = computeAveragedFFT(signalA, config, sampleRates.value.A);
      const fftResultB = computeAveragedFFT(signalB, config, sampleRates.value.B);

      spectra.value.A = extractSpectrum(fftResultA);
      spectra.value.B = extractSpectrum(fftResultB);

      logger.info('analysisStore', 'Spectra computed', {
        binsA: spectra.value.A.frequencies.length,
        binsB: spectra.value.B.frequencies.length,
        sampleRateA: sampleRates.value.A,
        sampleRateB: sampleRates.value.B,
      });
    } catch (error) {
      logger.error('analysisStore', 'FFT computation failed', { error: String(error) });
      throw error;
    }
  }

  /**
   * Tone-match IR: load the result after A and it takes on B's tone.
   * A is the working sound, B is the reference.
   *
   * The IR is rendered at A's sample rate, since that is what it will be played at.
   * B's spectrum is resampled onto A's frequency grid inside `deriveToneMatchIR`, so
   * the two files need not share a rate.
   */
  async function computeToneMatchIR(config: ToneMatchConfig = toneMatchConfig.value): Promise<void> {
    if (!spectra.value.A || !spectra.value.B) {
      throw new Error('Both spectra must be computed before deriving a tone-match IR');
    }

    toneMatchConfig.value = { ...toneMatchConfig.value, ...config };
    toneCurve.value = deriveToneCurve(
      spectra.value.A,
      spectra.value.B,
      sampleRates.value.A,
      toneMatchConfig.value,
    );
    ir.value = renderToneMatchIR(
      curveToRender(sampleRates.value.A)!,
      sampleRates.value.A,
      toneMatchConfig.value.taps!,
    );

    logger.info('analysisStore', 'Tone-match IR computed', {
      taps: ir.value.length,
      sampleRate: ir.value.sampleRate,
    });
    refreshLiveConvolver();
  }

  /**
   * Re-render the cached curve at another rate or length. Cheap — one cepstrum FFT, no
   * re-analysis — which is what makes both the tap selector and cross-rate export possible
   * without touching the audio.
   *
   * This is the export path. Resampling a finished IR is the thing it exists to avoid:
   * linear interpolation costs 6.3 dB at 20 kHz, and even a good resampler is solving a
   * harder problem than simply rendering the filter at the rate that was asked for.
   */
  function renderIRAt(sampleRate: number, taps: number): ImpulseResponse | null {
    const curve = curveToRender(sampleRate);
    if (!curve) return null;
    return renderToneMatchIR(curve, sampleRate, taps);
  }

  /**
   * Change the working tap count: re-renders in place so the live convolver and any
   * subsequent export both move together.
   */
  function setIRTaps(taps: number): void {
    if (!toneCurve.value) return;
    toneMatchConfig.value = { ...toneMatchConfig.value, taps };
    ir.value = renderToneMatchIR(curveToRender(sampleRates.value.A)!, sampleRates.value.A, taps);
    refreshLiveConvolver();
  }

  /**
   * `toneCurve` with the graphic EQ folded in, when it's on — the one seam every render
   * site goes through. Kept as a function rather than a computed: it takes a sample rate
   * (export can render at a rate other than the live one) and callers need the `null`
   * case anyway when there's nothing to render yet.
   */
  function curveToRender(sampleRate: number): ToneCurve | null {
    if (!toneCurve.value) return null;
    return applyGraphicEq(toneCurve.value, graphicEq.value, sampleRate);
  }

  /** Re-bakes the IR from the current curve + graphic EQ and hot-swaps the live convolver. */
  function rerenderIR(): void {
    if (!toneCurve.value) return;
    ir.value = renderToneMatchIR(
      curveToRender(sampleRates.value.A)!,
      sampleRates.value.A,
      toneMatchConfig.value.taps!,
    );
    refreshLiveConvolver();
  }

  function setGraphicEqEnabled(enabled: boolean): void {
    graphicEq.value.enabled = enabled;
    rerenderIR();
  }

  let graphicEqTimer: number | null = null;

  /**
   * Debounced 120ms rather than the 300ms `setToneMatchConfig` uses: this is meant to
   * feel live while dragging a handle, and the state write itself (below) is synchronous
   * and cheap — only the FFT-based minimum-phase bake needs debouncing.
   */
  function updateGraphicEqBand(id: string, partial: Partial<GraphicEqBand>): void {
    graphicEq.value.bands = graphicEq.value.bands.map((b) =>
      b.id === id ? { ...b, ...partial } : b,
    );
    if (!graphicEq.value.enabled || !toneCurve.value) return;
    if (graphicEqTimer !== null) clearTimeout(graphicEqTimer);
    graphicEqTimer = window.setTimeout(() => {
      graphicEqTimer = null;
      rerenderIR();
    }, 120);
  }

  let setToneMatchTimer: number | null = null;

  function setToneMatchConfig(partial: Partial<ToneMatchConfig>): void {
    toneMatchConfig.value = { ...toneMatchConfig.value, ...partial };
    if (!toneCurve.value) return;
    if (setToneMatchTimer !== null) clearTimeout(setToneMatchTimer);
    setToneMatchTimer = window.setTimeout(async () => {
      setToneMatchTimer = null;
      try {
        await computeToneMatchIR(toneMatchConfig.value);
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
        if (spectra.value.A) await computeSpectra(fftConfig.value, 'A');
        if (spectra.value.B) await computeSpectra(fftConfig.value, 'B');
      } catch (error) {
        reportError('setFFTConfig recompute failed', error, "Couldn't recompute the spectrum with the new FFT settings.");
      }
    }, 300);
  }

  // Both spectra just got (re)computed — re-derive IR, debounced so a burst of
  // per-slot spectrum updates (e.g. dragging both selections) coalesces into one pass.
  watch(
    () => [spectra.value.A, spectra.value.B],
    ([a, b]) => {
      if (!a || !b) return;
      if (autoIRTimer !== null) clearTimeout(autoIRTimer);
      autoIRTimer = window.setTimeout(async () => {
        autoIRTimer = null;
        try {
          // Carry the chosen tap count through — a selection drag must not silently
          // reset the filter length back to the default under the user.
          await computeToneMatchIR(toneMatchConfig.value);
        } catch (error) {
          reportError('Auto IR recompute failed', error, "Couldn't derive the impulse response.");
        }
      }, 100);
    },
  );

  // Hot-swap analyser when FFT size changes mid-playback
  watch(liveFFTSize, () => {
    if (analysers.value.length) createLiveAnalyser();
  });

  // Playback is already routed through convolverNode — hot-swap its buffer so a
  // live A/B or selection change is heard immediately, no restart needed.
  function refreshLiveConvolver(): void {
    if (!convolverNode || !audioContext || !ir.value) return;

    convolverNode.buffer = buildIRBuffer(audioContext, irAtContextRate(audioContext)!);
    // A new IR means new headroom, so the trim baked into the running
    // gain is stale — re-apply it at the current volume rather than waiting for a restart
    setVolume(playbackVolume.value);
    logger.debug('analysisStore', 'Live convolver buffer refreshed');
  }

  /**
   * Level both playback paths have to give up so the filter cannot clip.
   * Same value dry or wet, so switching A/B compares tone and not loudness.
   *
   * Measured, not bounded: this take through this filter, peak-read off the result. The
   * bounds are both far too pessimistic to listen through. `sum|h[n]|` is the gain for
   * `sign(h[-n])`, a sign-matched impulse train that no recording contains — it costs
   * 10.6 dB on a ±6 dB curve, and every dB of it comes off the dry path too, so cancelling
   * the reference made the whole app jump 10 dB louder. `max|H(f)|` is the steady-sine
   * bound and errs the other way on transients. The actual convolution answers the actual
   * question, and on real material it usually asks for no trim at all.
   */
  function headroomTrim(): number {
    const response = ir.value;
    if (!response) return 1;

    const source = audioBuffers.value.A;
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
      sampleRates.value.A || 44100,
    );

    logger.info('analysisStore', 'Headroom measured', {
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
   * rendered for, and the reference is a different file on its own timeline anyway, so
   * letting its source node resample it costs nothing tonally.
   */
  function playbackRate(slot: SlotId): number {
    if (audioBuffers.value.A.length > 0) return sampleRates.value.A || 44100;
    return audioHeaders.value[slot]?.sampleRate || sampleRates.value[slot] || 44100;
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
      logger.info('analysisStore', 'Rebuilding audio context for a new rate', {
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
   * The IR as the convolver must receive it: at the context's own rate, re-rendered from
   * the tone curve rather than resampled. Browsers are free to ignore the rate a context
   * was asked for, so this is checked against what the context actually reports.
   */
  function irAtContextRate(context: AudioContext): ImpulseResponse | null {
    const response = ir.value;
    if (!response) return null;
    if (Math.abs(response.sampleRate - context.sampleRate) < 1) return response;

    if (contextIR && contextIR.source === response && contextIR.rate === context.sampleRate) {
      return contextIR.rendered;
    }

    const rendered = renderIRAt(context.sampleRate, irTaps.value);
    if (!rendered) {
      logger.warn('analysisStore', 'No tone curve to re-render the IR at the context rate', {
        irRate: response.sampleRate,
        contextRate: context.sampleRate,
      });
      return response;
    }

    contextIR = { source: response, rate: context.sampleRate, rendered };
    logger.info('analysisStore', 'IR re-rendered at the context rate', {
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
  function playbackChannels(slot: SlotId): Float32Array[] {
    const channels = channelBuffers.value[slot];
    // More than stereo would be downmixed by the destination anyway, and the mixdown is
    // at least a known quantity
    if (channels.length === 0 || channels.length > 2) return [audioBuffers.value[slot]];

    const gain = normalized.value[slot] ? normalizeGains.value[slot] : 1;
    if (gain === 1) return channels;

    // Every seek restarts the transport, and scaling a stereo take on each one would
    // churn tens of megabytes per click
    const cached = scaledChannels.get(slot);
    if (cached && cached.source === channels && cached.gain === gain) return cached.channels;

    const scaled = channels.map((channel) => {
      const out = new Float32Array(channel.length);
      for (let i = 0; i < channel.length; i++) out[i] = channel[i] * gain;
      return out;
    });

    scaledChannels.set(slot, { source: channels, gain, channels: scaled });
    return scaled;
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

  /** Volume while sounding — the gain node stays in the graph for the whole take. */
  function setVolume(volume: number): void {
    playbackVolume.value = Math.max(0, Math.min(1, volume));
    if (!gainNode || !audioContext) return;
    // Ramped: stepping the gain on a sounding buffer clicks
    gainNode.gain.setTargetAtTime(gainFor(playbackVolume.value), audioContext.currentTime, 0.01);
  }

  /**
   * Three things you can listen to: the working sound dry (A), the same sound through
   * the derived filter (B), and the reference file itself (C).
   */
  async function playback(
    volume: number,
    mode: PlaybackMode = 'processed',
    offset = 0,
    loop = false,
    loopStartSeconds?: number,
    loopEndSeconds?: number,
  ): Promise<void> {
    const slot: SlotId = mode === 'reference' ? 'B' : 'A';
    const source = audioBuffers.value[slot];
    const useIR = mode === 'processed';
    logger.info('analysisStore', 'Starting playback', { volume, mode, samples: source.length, offset, loop, loopStartSeconds, loopEndSeconds });

    // Unconditional, even when the caller already stopped: two sources sounding at once
    // is the one failure the transport cannot recover from, so never rely on the caller
    stopPlayback();
    const generation = ++playbackGeneration;
    playbackVolume.value = Math.max(0, Math.min(1, volume));

    if (source.length === 0) {
      throw new Error(`No audio to play in slot ${slot}`);
    }
    if (useIR && !ir.value) {
      throw new Error('IR must be computed before playing the processed signal');
    }

    const slotRate = audioHeaders.value[slot]?.sampleRate || sampleRates.value[slot] || 44100;
    const startOffset = Math.max(0, Math.min(offset, source.length / slotRate));

    const context = ensureContext(playbackRate(slot));
    audioContext = context;

    // A context built outside a user gesture starts suspended: start() would schedule
    // silently and the transport would run with nothing audible
    if (context.state === 'suspended') {
      await context.resume();
      // A stop or a newer start happened while we were waiting — that one owns the output
      if (generation !== playbackGeneration) return;
    }

    // The take's own channels. The buffer keeps the slot's rate even when the context runs
    // at another one — the source node resamples it, which is a resample of program
    // material and not of a filter.
    const channels = playbackChannels(slot);
    const buffer = context.createBuffer(channels.length, channels[0].length, slotRate);
    for (let ch = 0; ch < channels.length; ch++) {
      buffer.getChannelData(ch).set(channels[ch]);
    }

    // Static headroom trim, measured off this take through this filter, applied to BOTH
    // paths so an A/B compares tone and not loudness.
    //
    // A compressor here would be worse than the clipping it prevents: it pumps on every
    // transient, its 3 ms attack smears attacks, WebAudio's DynamicsCompressorNode adds
    // several ms of latency, and putting it in the wet path only makes the A/B unfair on
    // top of that. The result reads as a blurred, unfocused match. A constant scalar
    // costs nothing but level, changes no tone, and keeps A and B directly comparable.
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

    if (useIR && ir.value) {
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
      logger.info('analysisStore', 'Playback ended');
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
    convolverNode?.disconnect();
    convolverNode = null;
    gainNode?.disconnect();
    gainNode = null;
    playbackState.value = 'idle';

    if (stopped > 0) {
      logger.info('analysisStore', 'Playback stopped', { sources: stopped });
    }
  }

  /**
   * Dropping a waveform invalidates the IR: it is a function of both spectra, so with
   * one slot gone there is nothing left to match against. Tear down the whole derived
   * chain — IR, live convolver, anything currently sounding — rather than leaving a
   * stale filter selectable in the transport.
   */
  function clearFile(slot: 'A' | 'B'): void {
    stopPlayback();

    audioBuffers.value[slot] = new Float32Array();
    sourceBuffers.value[slot] = new Float32Array();
    channelBuffers.value[slot] = [];
    normalized.value[slot] = false;
    normalizeGains.value[slot] = 1;
    audioHeaders.value[slot] = null;
    sampleRates.value[slot] = 44100;
    sourceNames.value[slot] = '';
    selections.value[slot] = { startSample: 0, endSample: 0, duration: 0 };
    spectra.value[slot] = null;
    playheads.value[slot] = null;

    // A pending auto-derive would resurrect the IR from the spectrum that is still there
    if (autoIRTimer !== null) {
      clearTimeout(autoIRTimer);
      autoIRTimer = null;
    }
    ir.value = null;
    toneCurve.value = null;
    convolverNode = null;
    contextIR = null;
    trimCache = null;
    scaledChannels.delete(slot);

    logger.info('analysisStore', `File cleared: ${slot}`, { irDiscarded: true });
  }

  // A hot update swaps this module out, and with it the only reference to whatever is
  // sounding — the old source plays on with no transport able to reach it. Silence it
  // while the closure that owns it is still alive.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => stopPlayback());
  }

  return {
    audioBuffers,
    sourceBuffers,
    normalized,
    normalizeGains,
    audioHeaders,
    sourceNames,
    sampleRates,
    selections,
    spectra,
    ir,
    toneCurve,
    graphicEq,
    irTaps,
    toneMatchConfig,
    fftConfig,
    playbackState,
    playbackVolume,
    liveFFTSize,
    playbackSource,
    analysers,
    playheads,
    isAutoComputing,
    lastError,
    recorder,
    recordingSlot,
    loadFile,
    recordAudio,
    stopRecording,
    swapSlots,
    updateSelection,
    computeSpectra,
    computeToneMatchIR,
    renderIRAt,
    setIRTaps,
    setToneMatchConfig,
    setFFTConfig,
    setGraphicEqEnabled,
    updateGraphicEqBand,
    playback,
    stopPlayback,
    setVolume,
    clearFile,
  };
});

// Setup-store logic doesn't hot-reload on its own — Pinia keeps the old instance
// alive across HMR unless it's told to swap it, so edits here silently no-op
// until this is wired up (or the page gets a hard refresh).
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAnalysisStore, import.meta.hot));
}
