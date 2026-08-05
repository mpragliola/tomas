import { computed, nextTick, onUnmounted, ref, watch, type Ref } from 'vue';
import { darkTheme, fullZoomSamplesPerPixel, type WaverTheme } from 'waver';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';
import { MIN_ANALYSIS_SECONDS } from '../services/dsp/defaults';

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 40;

/**
 * Floor only — a selection may run to the end of the file. Below this the Welch average is
 * a few frames of one transient (see MIN_ANALYSIS_SECONDS), so the FFT would refuse it.
 */
export const MIN_SELECTION_SEC = MIN_ANALYSIS_SECONDS;

/**
 * What a waveform (and, by extension, the spectrum scheduler) is being asked to render:
 * the working take, or one reference tab's audio. Shared between `useWaveformSlot` and
 * `useSpectrumScheduler` — both need the identical concept, so it's exported from here
 * rather than duplicated.
 */
export type WaveformTarget = 'A' | { referenceId: string };

// A single accent color per target — A blue, reference orange — layered onto the dark/retro
// base theme. Up to MAX_REFERENCES (8) reference tabs can exist, but this composable only
// ever renders one waveform at a time and doesn't render the tab bar, so one "reference"
// color for every non-A target is enough here.
type ColorKey = 'A' | 'reference';

const ACCENT_DARK: Record<ColorKey, string> = {
  A: '#5B93F5',
  reference: '#FFB44D',
};

const ACCENT_RETRO: Record<ColorKey, string> = {
  A: 'rgba(68, 255, 68, 0.95)',
  reference: 'rgba(51, 255, 51, 0.85)',
};

const RETRO_BASE: WaverTheme = {
  ...darkTheme,
  backgroundColor: '#0a0f0a',
  zeroLineColor: 'rgba(68, 255, 68, 0.15)',
  rulerColor: 'rgba(150, 255, 150, 0.55)',
};

function getTheme(): string {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function getWaverTheme(colorKey: ColorKey): Partial<WaverTheme> {
  const retro = getTheme() === 'retro';
  const base = retro ? RETRO_BASE : darkTheme;
  const waveformColor = (retro ? ACCENT_RETRO : ACCENT_DARK)[colorKey];
  return {
    ...base,
    waveformColor,
    cursorColor: waveformColor,
    minimapOverlayColor: base.minimapOverlayColor,
  };
}

export interface WaverHandle {
  loadSamples: (samples: Float32Array, sampleRate: number) => void;
  loadAudioBuffer: (buffer: AudioBuffer, context: AudioContext) => void;
  setSelection: (selection: { startSample: number; endSample: number } | null) => void;
  getSelection: () => { startSample: number; endSample: number } | null;
  setCursorPosition: (sample: number, emitEvent?: boolean) => void;
  getCursorPosition: () => number;
  setZoom: (zoom: { samplesPerPixel?: number; offsetSample?: number }, animate?: boolean) => void;
  zoomToFull: () => void;
  element: () => { clientWidth: number } | null;
  getSamples: () => Float32Array;
  getChannels: () => Float32Array[];
  getSampleRate: () => number;
  isRecording: () => boolean;
  isMonitoring: () => boolean;
  reset: () => void;
}

export interface WaveformSlotOptions {
  /** The waveform block is visible and laid out. */
  active: Ref<boolean>;
  onStatus?: (message: string, durationMs: number) => void;
  /** The analysis range changed; the owner decides what to recompute. */
  onSelectionChange?: () => void;
}

/**
 * waver lifecycle for one target: loading samples, zoom, and the drag-selected analysis
 * range. Knows nothing about file loading or DSP.
 */
export function useWaveformSlot(getTarget: () => WaveformTarget, waver: Ref<WaverHandle | null | undefined>, options: WaveformSlotOptions) {
  const store = useAnalysisStore();
  // Used only for log labels — 'A' or the reference id. A function, not a value snapshot:
  // this composable's setup runs once, but a caller like ReferenceSlot.vue reuses the same
  // WaveformEditor instance across tab switches (only the `target` prop value changes,
  // never the component itself) — a plain destructured `target` would freeze on whichever
  // tab was active when this ran, and every later switch would keep rendering that one.
  function currentLabel(): string {
    const t = getTarget();
    return t === 'A' ? 'A' : t.referenceId;
  }

  // A selection change fired while we are the one writing it back (restoreSelection) must
  // not bounce straight back into the store as if the user dragged it.
  let restoring = false;

  /**
   * The one seam every function below goes through instead of scattering
   * `target === 'A' ? x : y` ternaries. For 'A', reads/writes the store's flat A refs
   * directly. For a reference, reads its asset via `store.references`/`store.audioAssets`
   * and writes through `store.updateReferenceSelection` / the reference's own `playhead`.
   */
  function resolve() {
    const target = getTarget();
    if (target === 'A') {
      return {
        colorKey: 'A' as ColorKey,
        buffer: store.audioBufferA,
        channels: store.channelBufferA,
        sampleRate: store.sampleRateA,
        playhead: store.playheadA,
        selection: store.selectionA,
        setPlayhead(time: number): void {
          store.playheadA = time;
        },
        setSelection(startSample: number, endSample: number): void {
          store.updateSelectionA(startSample, endSample);
        },
      };
    }

    const referenceId = target.referenceId;
    const ref = store.references[referenceId];
    const asset = ref?.assetId ? store.audioAssets[ref.assetId] : undefined;
    return {
      colorKey: 'reference' as ColorKey,
      buffer: asset?.buffer ?? new Float32Array(),
      channels: asset?.channels ?? [],
      sampleRate: asset?.sampleRate ?? 44100,
      playhead: ref?.playhead ?? null,
      selection: ref?.selection ?? null,
      setPlayhead(time: number): void {
        const current = store.references[referenceId];
        if (current) current.playhead = time;
      },
      setSelection(startSample: number, endSample: number): void {
        store.updateReferenceSelection(referenceId, startSample, endSample);
      },
    };
  }

  // flush: 'post' — the v-show has already been applied when this runs. `getTarget` is a
  // second dependency, not just `options.active`: reusing one WaveformEditor instance
  // across reference tabs means the same visible=true state persists across a tab switch,
  // so `getTarget` changing is what has to trigger the reload — the same waver instance
  // stays mounted, only the samples/selection loaded into it change.
  watch(
    [options.active, getTarget],
    ([visible]) => {
      if (visible) load();
    },
    { flush: 'post', immediate: true },
  );

  // The transport lives in another panel, so the position arrives through the store
  watch(() => resolve().playhead, syncCursor);

  // Buffers are reassigned wholesale on load/record (never mutated in place), so a
  // reference change here reliably means "different audio" for the currently shown
  // target — a target switch is handled separately by the watch above, via load().
  watch(() => resolve().buffer, load);

  // Watch for theme changes and update colors without reinit
  const currentTheme = ref(getTheme());
  const setupThemeObserver = () => {
    const observer = new MutationObserver(() => {
      const newTheme = getTheme();
      if (newTheme !== currentTheme.value) currentTheme.value = newTheme;
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return observer;
  };
  let themeObserver: MutationObserver | null = null;
  if (typeof window !== 'undefined') {
    themeObserver = setupThemeObserver();
  }

  onUnmounted(() => themeObserver?.disconnect());

  async function load(): Promise<void> {
    await nextTick();

    const el = waver.value;
    if (!el) return;

    const resolved = resolve();
    const audioData = resolved.buffer;
    if (audioData.length === 0) return;

    try {
      if (resolved.channels.length > 1) {
        // Stereo/multichannel source: hand waver a real AudioBuffer with every channel so
        // it renders stacked per-channel lanes. Analysis still reads `resolved.buffer`
        // (the single analysis channel resolved upstream), unaffected by this. An
        // OfflineAudioContext is enough to construct the buffer — nothing here plays
        // audio or touches a device, so there is no reason to open a live AudioContext.
        const offlineCtx = new OfflineAudioContext(resolved.channels.length, audioData.length, resolved.sampleRate);
        const audioBuffer = offlineCtx.createBuffer(resolved.channels.length, audioData.length, resolved.sampleRate);
        resolved.channels.forEach((channel, i) => audioBuffer.copyToChannel(channel, i));
        el.loadAudioBuffer(audioBuffer, offlineCtx as unknown as AudioContext);
      } else {
        el.loadSamples(audioData, resolved.sampleRate);
      }
      el.zoomToFull();
      syncCursor();
      restoreSelection();

      logger.debug('WaveformSlot', `Waveform ${currentLabel()} loaded`, {
        samples: audioData.length,
        sampleRate: resolved.sampleRate,
        channels: resolved.channels.length || 1,
      });
    } catch (error) {
      logger.error('WaveformSlot', `Failed to load waveform ${currentLabel()}`, { error: String(error) });
    }
  }

  /**
   * A flick of a drag lands well under the analysis floor, and the FFT would just refuse
   * it. Grow it instead — forward if there is room, backward otherwise. A file shorter
   * than the floor is left alone; nothing here can make it analysable.
   */
  function widenToMinimum(startSample: number, endSample: number, sampleRate: number, totalSamples: number): [number, number] {
    const minSamples = Math.round(MIN_SELECTION_SEC * sampleRate);
    if (endSample - startSample >= minSamples || totalSamples < minSamples) return [startSample, endSample];

    const start = Math.min(startSample, totalSamples - minSamples);
    options.onStatus?.(`Selection widened to the ${MIN_SELECTION_SEC}s minimum`, 2000);
    return [start, start + minSamples];
  }

  /** Called from the owning component on the waver `selectionchange` event. */
  function onSelectionChange(selection: { startSample: number; endSample: number } | null): void {
    if (restoring) return;
    const resolved = resolve();

    if (!selection) {
      resolved.setSelection(0, 0);
      options.onSelectionChange?.();
      return;
    }

    const [startSample, endSample] = widenToMinimum(
      selection.startSample,
      selection.endSample,
      resolved.sampleRate,
      resolved.buffer.length,
    );
    if (startSample !== selection.startSample || endSample !== selection.endSample) {
      restoring = true;
      waver.value?.setSelection({ startSample, endSample });
      restoring = false;
    }
    resolved.setSelection(startSample, endSample);
    options.onSelectionChange?.();
  }

  /** Called from the owning component on the waver `cursorchange` event (click-to-seek). */
  function onCursorChange(positionSample: number): void {
    const resolved = resolve();
    resolved.setPlayhead(positionSample / resolved.sampleRate);
  }

  /**
   * Redraw the selection from the store rather than whatever waver still has on screen —
   * after a target swap the store's selection is already the new audio's.
   *
   * A fresh load's selection defaults to the whole clip (see analysisStore) — drawn as an
   * actual waver selection, that would cover the entire body, and waver treats a drag
   * starting inside a selection's body as "move it", not "start a new one". A full-clip
   * selection can't move (already clamped to the bounds), so every drag would look like a
   * no-op. Left un-drawn instead: the footer label still reads it straight from the store,
   * but waver sees empty space and a drag correctly starts a new selection.
   */
  function restoreSelection(): void {
    const el = waver.value;
    if (!el) return;

    const resolved = resolve();
    const selection = resolved.selection;
    const isFullClip = selection && selection.startSample <= 0 && selection.endSample >= resolved.buffer.length;
    restoring = true;
    if (!selection || selection.endSample <= selection.startSample || isFullClip) {
      el.setSelection(null);
    } else {
      el.setSelection({ startSample: selection.startSample, endSample: selection.endSample });
    }
    restoring = false;
  }

  /** Draw the store's position as waver's cursor — not a user interaction, so no event back out. */
  function syncCursor(): void {
    const el = waver.value;
    if (!el) return;
    const resolved = resolve();
    el.setCursorPosition(Math.round((resolved.playhead ?? 0) * resolved.sampleRate), false);
  }

  /** Clears the drag-selected analysis range. */
  function clearSelection(): void {
    restoring = true;
    waver.value?.setSelection(null);
    restoring = false;
    resolve().setSelection(0, 0);
    options.onSelectionChange?.();
  }

  function clampZoom(level: number): number {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
  }

  /** Recomputed on demand from the live buffer length and rendered width, rather than
   * cached at load time — the container can resize (sidebar toggle, window resize)
   * between a load and a zoom, and a stale baseline would throw the slider's level off. */
  function fitSamplesPerPixel(): number | null {
    const width = waver.value?.element()?.clientWidth ?? 0;
    const total = resolve().buffer.length;
    if (!width || !total) return null;
    return fullZoomSamplesPerPixel(total, width);
  }

  const zoom = ref(ZOOM_MIN);

  /** zoom 1 = whole file fits the component; higher = fewer samples per pixel (zoomed in). */
  function setZoom(level: number): void {
    const el = waver.value;
    const fit = fitSamplesPerPixel();
    if (!el || fit === null) return;

    const clamped = clampZoom(level);
    if (clamped <= ZOOM_MIN) {
      el.zoomToFull();
      return;
    }
    // animate: false — a dragged range input fires many updates in quick succession, and
    // queuing a fresh eased transition on every one of them makes the slider lag behind.
    el.setZoom({ samplesPerPixel: fit / clamped }, false);
  }

  /** Mirrors waver's own zoom back onto the slider — wheel zoom, minimap drag, and
   * zoomToFull() all change zoom without going through setZoom() above. */
  function onZoomChange(zoomState: { samplesPerPixel: number }): void {
    const fit = fitSamplesPerPixel();
    if (fit === null || !zoomState.samplesPerPixel) return;
    zoom.value = clampZoom(fit / zoomState.samplesPerPixel);
  }

  function resetView(): void {
    waver.value?.zoomToFull();
    clearSelection();
  }

  // Recomputed whenever the theme observer flips currentTheme, or the target (and
  // therefore colorKey) changes — `currentTheme.value` is read only to be tracked here,
  // getWaverTheme itself re-reads the DOM attribute directly.
  const theme = computed(() => {
    void currentTheme.value;
    return getWaverTheme(resolve().colorKey);
  });

  return {
    theme,
    zoom,
    setZoom,
    resetView,
    onSelectionChange,
    onCursorChange,
    onZoomChange,
  };
}
