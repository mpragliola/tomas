import { nextTick, onUnmounted, ref, watch, type Ref } from 'vue';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import HoverPlugin from 'wavesurfer.js/dist/plugins/hover.esm.js';
import MinimapPlugin from 'wavesurfer.js/dist/plugins/minimap.esm.js';
import SpectrogramPlugin from 'wavesurfer.js/dist/plugins/spectrogram.esm.js';
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

const ZOOM_WHEEL_STEP = 1.15;

/**
 * What a waveform (and, by extension, the spectrum scheduler) is being asked to render:
 * the working take, or one reference tab's audio. Shared between `useWaveformSlot` and
 * `useSpectrumScheduler` — both need the identical concept, so it's exported from here
 * rather than duplicated.
 */
export type WaveformTarget = 'A' | { referenceId: string };

// waveColor carries the waveform; progressColor and cursorColor are the transport, driven
// from the store's position rather than by WaveSurfer playing anything itself.
//
// Up to MAX_REFERENCES (8) reference tabs can exist, but this composable only ever renders
// one waveform at a time and doesn't render the tab bar — a single "reference" color used
// for every non-A target is enough here. Per-tab-distinct waveform colors, if ever wanted,
// would be a UI-only addition on top of this (e.g. tinting via CSS filter), not a reason to
// thread an 8-color palette through every function below.
type ColorKey = 'A' | 'reference';

const WAVE_COLORS_DARK: Record<ColorKey, Record<string, string>> = {
  A: {
    waveColor: '#5B93F5',
    progressColor: '#2563EB',
    cursorColor: '#2563EB',
    regionColor: 'rgba(37, 99, 235, 0.22)',
    overlayColor: 'rgba(37, 99, 235, 0.18)',
  },
  reference: {
    waveColor: '#FFB44D',
    progressColor: '#FF9500',
    cursorColor: '#FF9500',
    regionColor: 'rgba(255, 149, 0, 0.22)',
    overlayColor: 'rgba(255, 149, 0, 0.18)',
  },
};

const WAVE_COLORS_RETRO: Record<ColorKey, Record<string, string>> = {
  A: {
    waveColor: 'rgba(100, 200, 100, 0.8)',
    progressColor: 'rgba(68, 255, 68, 0.95)',
    cursorColor: 'rgba(68, 255, 68, 0.95)',
    regionColor: 'rgba(68, 255, 68, 0.22)',
    overlayColor: 'rgba(68, 255, 68, 0.18)',
  },
  reference: {
    waveColor: 'rgba(85, 170, 85, 0.8)',
    progressColor: 'rgba(51, 255, 51, 0.85)',
    cursorColor: 'rgba(51, 255, 51, 0.85)',
    regionColor: 'rgba(51, 255, 51, 0.22)',
    overlayColor: 'rgba(51, 255, 51, 0.18)',
  },
};

function getTheme(): string {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function getWaveColors(colorKey: ColorKey): Record<string, string> {
  return getTheme() === 'retro' ? WAVE_COLORS_RETRO[colorKey] : WAVE_COLORS_DARK[colorKey];
}

const MINIMAP_HEIGHT = 26;
const SPECTROGRAM_HEIGHT = 96;
const SPECTROGRAM_FFT_SAMPLES = 4096;

export interface WaveformSlotOptions {
  /** The waveform block is visible and laid out — WaveSurfer can measure the container. */
  active: Ref<boolean>;
  /** Host for the minimap strip. Omitted (or empty) means no minimap plugin. */
  minimapContainer?: Ref<HTMLElement | undefined>;
  /** Host for the spectrogram. Omitted (or empty) means no spectrogram plugin. */
  spectrogramContainer?: Ref<HTMLElement | undefined>;
  onStatus?: (message: string, durationMs: number) => void;
  /** The analysis range changed; the owner decides what to recompute. */
  onSelectionChange?: () => void;
}

/**
 * WaveSurfer lifecycle for one target: rendering, zoom, panning and the drag-selected
 * analysis range. Knows nothing about file loading or DSP.
 */
export function useWaveformSlot(
  getTarget: () => WaveformTarget,
  container: Ref<HTMLElement | undefined>,
  options: WaveformSlotOptions,
) {
  const store = useAnalysisStore();
  const zoom = ref(1);
  // Used only for log labels — 'A' or the reference id. A function, not a value snapshot:
  // this composable's setup runs once, but a caller like ReferenceSlot.vue reuses the same
  // WaveformEditor instance across tab switches (only the `target` prop value changes,
  // never the component itself) — a plain destructured `target` would freeze on whichever
  // tab was active when this ran, and every later switch would keep rendering that one.
  function currentLabel(): string {
    const t = getTarget();
    return t === 'A' ? 'A' : t.referenceId;
  }

  // Overlay scroll indicator (percent of the scrollable width), replaces the native
  // scrollbar so the waveform keeps its full height
  const scrollBar = ref({ visible: false, left: 0, width: 100 });

  let wave: any = null;
  let regions: any = null;
  let spectrogram: any = null;
  let scrollCleanup: (() => void) | null = null;
  let dblClickCleanup: (() => void) | null = null;
  // Lives inside the spectrogram plugin's own scrolling wrapper, so it scrolls with the
  // content the same way WaveSurfer's built-in cursor does inside the main waveform.
  let spectrogramCursor: HTMLElement | null = null;
  // Ids of regions created by restoreSelectionRegion's own addRegion(...) — checked (not a
  // transient flag) because the plugin can defer the actual 'region-created'/'region-updated'
  // emission until WaveSurfer's own 'ready' fires, well after addRegion() itself returns; a
  // flag reset synchronously right after the call would already be back to false by then.
  const restoredRegionIds = new Set<string>();

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
        peaks: store.wavePeakA,
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
      peaks: asset?.wavePeaks ?? new Float32Array(),
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
  // so `getTarget` changing is what has to trigger the rebuild — `init()` already tears
  // down and recreates the WaveSurfer instance, which is exactly what a different target's
  // buffer/selection/regions needs, not an in-place `repaint()`.
  watch(
    [options.active, getTarget],
    ([visible]) => {
      if (visible) init();
      else destroy();
    },
    { flush: 'post', immediate: true },
  );

  // The transport lives in another panel, so the position arrives through the store
  watch(() => resolve().playhead, syncCursor);

  // Buffers are reassigned wholesale on load/record (never mutated in place), so a
  // reference change here reliably means "different audio" for the currently shown
  // target — a target switch is handled separately by the watch above, via init().
  watch(() => resolve().buffer, async () => {
    if (!wave) return;
    await repaint();
    zoom.value = 1;
    applyZoom();
    restoreSelectionRegion();
  });

  // Watch for theme changes and update colors without reinit
  const currentTheme = ref(getTheme());
  const setupThemeObserver = () => {
    const observer = new MutationObserver(() => {
      const newTheme = getTheme();
      if (newTheme !== currentTheme.value) {
        currentTheme.value = newTheme;
        updateWaveformColors();
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return observer;
  };
  let themeObserver: MutationObserver | null = null;
  if (typeof window !== 'undefined') {
    themeObserver = setupThemeObserver();
  }

  function updateWaveformColors(): void {
    if (!wave) return;

    const { regionColor, overlayColor, ...colors } = getWaveColors(resolve().colorKey);
    try {
      wave.setOptions(colors);
    } catch (error) {
      logger.debug('WaveformSlot', `setOptions failed for ${currentLabel()}`, { error: String(error) });
    }
  }

  onUnmounted(() => {
    destroy();
    themeObserver?.disconnect();
  });

  function destroy(): void {
    if (!wave) return;
    try {
      wave.destroy();
    } catch (error) {
      logger.debug('WaveformSlot', `Destroy ${currentLabel()} failed`, { error: String(error) });
    }
    // MinimapPlugin doesn't reliably clean up its own wrapper on destroy — its wrapper is
    // left behind in the host container, and the next init()'s minimap stacks on top of
    // it instead of replacing it. Clearing the host ourselves guarantees a clean slate
    // regardless of what the plugin's own teardown did or didn't do.
    if (options.minimapContainer?.value) options.minimapContainer.value.innerHTML = '';
    wave = null;
    regions = null;
    spectrogram = null;
    scrollCleanup?.();
    scrollCleanup = null;
    dblClickCleanup?.();
    dblClickCleanup = null;
    scrollBar.value.visible = false;
    spectrogramCursor = null;
    restoredRegionIds.clear();
  }

  async function init(): Promise<void> {
    await nextTick();

    const element = container.value;
    if (!element) {
      logger.warn('WaveformSlot', `No container for waveform ${currentLabel()}`);
      return;
    }

    const audioData = resolve().buffer;
    if (audioData.length === 0) return;

    // A hidden or not-yet-laid-out container measures 0px wide and WaveSurfer would
    // render an empty canvas — wait for layout instead
    if (element.clientWidth === 0) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (element.clientWidth === 0) {
        logger.warn('WaveformSlot', `Container ${currentLabel()} has zero width, skipping render`);
        return;
      }
    }

    destroy();

    try {
      const resolved = resolve();
      const sampleRate = resolved.sampleRate;
      const { regionColor, overlayColor, ...colors } = getWaveColors(resolved.colorKey);

      regions = RegionsPlugin.create();

      // Seconds, not m:ss — the files here are short and the selection edges are read
      // off the same scale as the footer's selection label
      const hover = HoverPlugin.create({
        lineColor: colors.cursorColor,
        lineWidth: 1,
        labelSize: 10,
        labelColor: '#fff',
        labelBackground: 'rgba(0, 0, 0, 0.7)',
        labelPreferLeft: false,
        formatTimeCallback: (seconds: number) => `${seconds.toFixed(2)}s`,
      });

      const plugins: any[] = [regions, hover];

      // Both extra views render into their own hosts; dropping them into the waveform
      // container would break the scrollbar lookup and the crosshair cursor rule
      const minimapEl = options.minimapContainer?.value;
      if (minimapEl) {
        plugins.push(
          MinimapPlugin.create({
            container: minimapEl,
            height: MINIMAP_HEIGHT,
            waveColor: 'rgba(255,255,255,.5)',
            progressColor: colors.progressColor,
            cursorColor: colors.cursorColor,
            overlayColor,
          }),
        );
      }

      const spectrogramEl = options.spectrogramContainer?.value;
      if (spectrogramEl) {
        // useWebWorker: the FFT for a zoomed-in view is big enough to stall the main
        // thread, which would also stall the drag that triggered it
        spectrogram = SpectrogramPlugin.create({
          container: spectrogramEl,
          height: SPECTROGRAM_HEIGHT,
          fftSamples: SPECTROGRAM_FFT_SAMPLES,
          frequencyMax: 22_000,
          scale: 'mel',
          colorMap: 'roseus',
          labels: false,
          useWebWorker: true,
        });
        plugins.push(spectrogram);
      }

      wave = WaveSurfer.create({
        container: element,
        ...colors,
        height: 80,
        normalize: false,
        peaks: [resolved.peaks],
        duration: audioData.length / sampleRate,
        minPxPerSec: 1,
        autoScroll: true,
        plugins,
      });

      // Drag anywhere on the waveform to define the analysis range — up to the whole file.
      // minLength is enforced by the plugin when resizing an existing region; the initial
      // drag bypasses it, so region-created widens as well.
      regions.enableDragSelection({ color: regionColor, minLength: MIN_SELECTION_SEC });

      regions.on('region-created', (region: any) => {
        // single selection per target
        for (const other of regions.getRegions()) {
          if (other.id !== region.id) other.remove();
        }
        // restoreSelectionRegion's own addRegion(...) fires this same event — a previously
        // stored (already-analyzed) selection must be redrawn as-is, not treated like a
        // fresh user drag and widened/re-synced back onto the store.
        if (restoredRegionIds.has(region.id)) return;
        // Deferred: the plugin is still finishing its own bookkeeping for this region,
        // and mutating it synchronously leaves the drag handler holding a stale edge
        setTimeout(() => {
          widenToMinimum(region);
          syncSelection(region);
        }, 0);
      });
      regions.on('region-updated', (region: any) => {
        if (restoredRegionIds.has(region.id)) return;
        syncSelection(region);
      });

      // A click on the waveform is a seek. WaveSurfer has already moved its own cursor by
      // the time this fires; publishing the time is what makes the transport follow.
      wave.on('interaction', (time: number) => {
        resolve().setPlayhead(time);
      });

      // A double-click's first click has already seeked (via 'interaction' above, twice) —
      // clearing the selection on top of that is the same "start fresh here" gesture as a
      // drag, just without one.
      element.addEventListener('dblclick', clearSelection);
      dblClickCleanup = () => element.removeEventListener('dblclick', clearSelection);

      hideNativeScrollbar(element);
      trackScroll();

      zoom.value = 1;
      applyZoom();
      // A fresh instance renders at 0 — restore whatever the transport is already on
      syncCursor();
      // A fresh regions plugin starts with nothing drawn — restore the store's selection
      // now rather than leaving it to the buffer-identity watch below, which races this
      // very function on a target switch and can lose (silently skip) the restore if it
      // fires before `wave` exists.
      restoreSelectionRegion();

      logger.info('WaveformSlot', `Waveform ${currentLabel()} initialized`, {
        samples: audioData.length,
        sampleRate,
        width: element.clientWidth,
      });
    } catch (error) {
      logger.error('WaveformSlot', `Failed to init waveform ${currentLabel()}`, { error: String(error) });
    }
  }

  /**
   * Repaint from the store's current samples, keeping the instance — and therefore
   * the selection region — alive, unlike a re-init.
   *
   * setOptions({ peaks, duration }) looks like the right call but is a no-op on an
   * already-rendered instance: it swaps WaveSurfer's internal decoded buffer, but the
   * renderer's reRender() repaints from its own cached copy, which only gets refreshed
   * by the 'decode' path inside load(). Going through load() with the new peaks as
   * pre-decoded channel data is what actually reaches the renderer.
   */
  async function repaint(): Promise<void> {
    if (!wave) return;
    const resolved = resolve();
    const audioData = resolved.buffer;
    // The spectrogram keys its cache off the decoded buffer; new samples for the same
    // instance (normalize) must not repaint the old picture
    spectrogram?.clearCache?.();
    await wave.load('', [resolved.peaks], audioData.length / resolved.sampleRate);
    syncCursor();
  }

  /**
   * A flick of a drag lands well under the analysis floor, and the FFT would just refuse
   * it. Grow it instead — forward if there is room, backward otherwise. A file shorter
   * than the floor is left alone; nothing here can make it analysable.
   */
  function widenToMinimum(region: any): void {
    const duration = wave?.getDuration() ?? 0;
    if (region.end - region.start >= MIN_SELECTION_SEC || duration < MIN_SELECTION_SEC) return;

    const start = Math.min(region.start, duration - MIN_SELECTION_SEC);
    region.setOptions({ start, end: start + MIN_SELECTION_SEC });
    options.onStatus?.(`Selection widened to the ${MIN_SELECTION_SEC}s minimum`, 2000);
  }

  function syncSelection(region: any): void {
    const resolved = resolve();
    const total = resolved.buffer.length;
    const startSample = Math.max(0, Math.round(region.start * resolved.sampleRate));
    const endSample = Math.min(total, Math.round(region.end * resolved.sampleRate));
    resolved.setSelection(startSample, endSample);

    options.onSelectionChange?.();
  }

  /**
   * Redraw the region from the store's selection rather than whatever the plugin still
   * has on screen — after a swap the store's selection is already the new audio's, but
   * the region graphic is still the old audio's.
   */
  function restoreSelectionRegion(): void {
    if (!regions) return;
    regions.clearRegions();

    const resolved = resolve();
    const selection = resolved.selection;
    if (!selection || selection.endSample <= selection.startSample) return;

    const { regionColor } = getWaveColors(resolved.colorKey);
    const region = regions.addRegion({
      start: selection.startSample / resolved.sampleRate,
      end: selection.endSample / resolved.sampleRate,
      color: regionColor,
    });
    restoredRegionIds.add(region.id);
  }

  function getScroller(): HTMLElement | null {
    return (wave?.getWrapper()?.parentElement as HTMLElement) ?? null;
  }

  // WaveSurfer's scroll container lives in a shadow root, so page CSS cannot reach it.
  // Killing the native scrollbar there is what frees up the waveform height.
  function hideNativeScrollbar(element: HTMLElement): void {
    const host = element.querySelector<HTMLElement>(':scope > div:not(.scroll-overlay)');
    const shadow = (host as any)?.shadowRoot as ShadowRoot | undefined;
    if (!shadow || shadow.querySelector('style[data-no-scrollbar]')) return;

    const style = document.createElement('style');
    style.setAttribute('data-no-scrollbar', '');
    style.textContent = `
      [part~="scroll"] { scrollbar-width: none; -ms-overflow-style: none; }
      [part~="scroll"]::-webkit-scrollbar { display: none; width: 0; height: 0; }
    `;
    shadow.appendChild(style);
  }

  function updateScrollBar(): void {
    const el = getScroller();
    const bar = scrollBar.value;
    if (!el || el.scrollWidth <= el.clientWidth + 1) {
      bar.visible = false;
      return;
    }
    bar.visible = true;
    bar.width = (el.clientWidth / el.scrollWidth) * 100;
    bar.left = (el.scrollLeft / el.scrollWidth) * 100;
  }

  /**
   * Draw the store's position with WaveSurfer's own cursor and progress fill. setTime also
   * writes media.currentTime, which is inert here — the media element has no source, the
   * audio comes out of the store's graph — but the render is the part we want.
   */
  function syncCursor(): void {
    if (!wave) return;
    wave.setTime(resolve().playhead ?? 0);
    keepCursorVisible();
    syncSpectrogramCursor();
  }

  /**
   * The spectrogram plugin draws no playhead of its own, so a cursor line is injected
   * into its scrolling wrapper — placed at a content-relative offset (px-per-second times
   * the time), it rides along with the plugin's own auto-scroll instead of needing
   * separate scroll tracking the way the overlay scrollbar does for the main waveform.
   */
  function syncSpectrogramCursor(): void {
    const host = options.spectrogramContainer?.value;
    const element = container.value;
    if (!wave || !host || !element) return;

    const duration = wave.getDuration();
    if (!duration) return;

    const wrapper = host.querySelector<HTMLElement>(':scope > div');
    if (!wrapper) return;

    if (!spectrogramCursor || spectrogramCursor.parentElement !== wrapper) {
      spectrogramCursor = document.createElement('div');
      spectrogramCursor.className = 'spectrogram-cursor';
      spectrogramCursor.style.cssText =
        `position: absolute; top: 0; bottom: 0; width: 1px; pointer-events: none; ` +
        `z-index: 5; background-color: ${getWaveColors(resolve().colorKey).cursorColor};`;
      wrapper.appendChild(spectrogramCursor);
    }

    const pxPerSec = (element.clientWidth / duration) * zoom.value;
    const time = resolve().playhead ?? 0;
    spectrogramCursor.style.left = `${time * pxPerSec}px`;
  }

  /**
   * WaveSurfer only auto-scrolls while its own media plays, which never happens here, so
   * zoomed in the cursor would walk off screen and stay there.
   */
  function keepCursorVisible(): void {
    const time = resolve().playhead;
    const el = getScroller();
    const duration = wave?.getDuration() ?? 0;
    if (time === null || !el || !duration) return;

    const x = (time / duration) * el.scrollWidth;
    if (x >= el.scrollLeft && x <= el.scrollLeft + el.clientWidth) return;
    el.scrollLeft = x - el.clientWidth / 2;
  }

  function trackScroll(): void {
    scrollCleanup?.();
    const el = getScroller();
    if (!el) return;

    const onScroll = () => updateScrollBar();
    el.addEventListener('scroll', onScroll, { passive: true });
    scrollCleanup = () => el.removeEventListener('scroll', onScroll);
    updateScrollBar();
  }

  // The overlay pill doubles as the pan control, since there is no native scrollbar left
  function startScrollDrag(event: PointerEvent): void {
    const el = getScroller();
    if (!el) return;

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startScrollLeft = el.scrollLeft;
    const ratio = el.scrollWidth / el.clientWidth;

    const onMove = (e: PointerEvent) => {
      el.scrollLeft = startScrollLeft + (e.clientX - startX) * ratio;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // anchor pins a time to a viewport offset; without it the viewport centre is kept
  function applyZoom(anchor?: { time: number; offsetX: number }): void {
    const element = container.value;
    if (!wave || !element) return;

    const duration = wave.getDuration();
    if (!duration) return;

    const scroller = getScroller();
    let anchorTime = anchor?.time ?? duration / 2;
    const anchorOffset = anchor?.offsetX ?? (scroller?.clientWidth ?? element.clientWidth) / 2;

    // Remember what is currently in the middle of the viewport so zoom stays anchored there
    if (!anchor && scroller && scroller.scrollWidth > 0) {
      const oldPxPerSec = scroller.scrollWidth / duration;
      anchorTime = (scroller.scrollLeft + scroller.clientWidth / 2) / oldPxPerSec;
    }

    // zoom 1 = whole file fits the container; higher = px/sec multiplied from there
    const fitPxPerSec = element.clientWidth / duration;
    const pxPerSec = fitPxPerSec * zoom.value;
    wave.setOptions({ minPxPerSec: pxPerSec });

    // Re-centre once the new width has been laid out
    requestAnimationFrame(() => {
      const el = getScroller();
      if (!el) return;
      el.scrollLeft = anchorTime * pxPerSec - anchorOffset;
      updateScrollBar();
    });
    syncSpectrogramCursor();
  }

  function clampZoom(level: number): number {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
  }

  function setZoom(level: number): void {
    zoom.value = clampZoom(level);
    applyZoom();
  }

  // Wheel over the waveform zooms around the pointer; shift (or a horizontal wheel) pans
  function handleWheel(event: WheelEvent): void {
    const el = getScroller();
    if (!wave || !el) return;

    const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
    event.preventDefault();

    if (horizontal) {
      el.scrollLeft += event.deltaX || event.deltaY;
      updateScrollBar();
      return;
    }

    const next = clampZoom(zoom.value * (event.deltaY < 0 ? ZOOM_WHEEL_STEP : 1 / ZOOM_WHEEL_STEP));
    if (next === zoom.value) return;

    // Time currently under the cursor, so that spot stays put across the scale change
    const duration = wave.getDuration();
    const offsetX = event.clientX - el.getBoundingClientRect().left;
    const oldPxPerSec = el.scrollWidth / duration;
    const anchorTime = duration ? (el.scrollLeft + offsetX) / oldPxPerSec : 0;

    zoom.value = next;
    applyZoom({ time: anchorTime, offsetX });
  }

  /** Clears the drag-selected analysis range — on its own via double-click, or as part
   * of a full resetView(). */
  function clearSelection(): void {
    regions?.clearRegions();
    resolve().setSelection(0, 0);
  }

  function resetView(): void {
    zoom.value = 1;
    applyZoom();
    clearSelection();
  }

  return {
    zoom,
    scrollBar,
    destroy,
    repaint,
    setZoom,
    handleWheel,
    startScrollDrag,
    resetView,
  };
}
