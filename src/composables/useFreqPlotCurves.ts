import { ref, shallowRef, computed, watch, onUnmounted } from 'vue';
import type { Ref } from 'vue';
import type { Curve, PlotCurve, EqCurve, EqBand, PeakType, PlotPoint } from 'freqplot';
import { useAnalysisStore } from '../stores/analysisStore';
import { irMagnitudeResponse } from '../services/dsp/irResponse';
import { graphicEqResponseDb } from '../services/dsp/graphicEqResponse';
import { fixedMagnitudeRange, lastFrequency } from '../utils/spectrumUtils';
import { logger } from '../services/logging';
import type { GraphicEqBand, GraphicEqBandType } from '../types/graphicEq';

const MIN_PLOT_FREQ = 20;
const FALLBACK_MAX_FREQ = 20000;
const FALLBACK_MIN_VALUE = -60;
const FALLBACK_MAX_VALUE = 0;
const CURVE_SMOOTHING = 6; // 1/6 octave

function toPeakType(type: GraphicEqBandType): PeakType {
  return type === 'peaking' ? 'peak' : type;
}

function toGraphicEqBandType(type: PeakType): GraphicEqBandType {
  return type === 'peak' ? 'peaking' : type;
}

function toPoints(frequencies: ArrayLike<number>, values: ArrayLike<number>): PlotPoint[] {
  const points: PlotPoint[] = new Array(frequencies.length);
  for (let i = 0; i < frequencies.length; i++) points[i] = { freq: frequencies[i], value: values[i] };
  return points;
}

function getTheme(): string {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function getColorPalette() {
  const theme = getTheme();
  if (theme === 'retro') {
    return {
      liveStroke: 'rgba(68, 255, 68, 0.95)',
      liveFill: 'rgba(30, 80, 30, 0.35)',
      averageStroke: 'rgba(51, 255, 51, 0.85)',
      spectrumA: 'rgba(51, 255, 51, 0.95)',
      spectrumB: 'rgba(34, 153, 34, 0.9)',
      irStroke: 'rgba(85, 170, 85, 0.8)',
      irFill: 'rgba(60, 140, 60, 0.2)',
      eqStroke: 'rgba(100, 200, 100, 0.85)',
    };
  }
  return {
    liveStroke: 'rgba(74, 222, 128, 0.9)',
    liveFill: 'rgba(34, 197, 94, 0.18)',
    averageStroke: 'rgba(74, 222, 128, 0.9)',
    spectrumA: '#2563EB',
    spectrumB: '#FF9500',
    irStroke: 'rgba(139, 92, 246, 0.55)',
    irFill: 'rgba(139, 92, 246, 0.12)',
    eqStroke: 'rgba(6, 214, 160, 0.8)',
  };
}

/**
 * Builds the `Curve[]` fed to the `<Freqplot>` component from the store's live and static
 * spectrum data.
 */
export function useFreqPlotCurves(
  liveFrequencies: Ref<number[] | null>,
  liveMagnitudesDb: Ref<Float32Array | null>,
  liveAverageDb: Ref<Float32Array | null>
) {
  const store = useAnalysisStore();

  /** What the legend has shown or hidden, keyed by curve id — survives a curve dropping
   * out of the list entirely (e.g. live pausing), which freqplot's own `hidden` Set does not. */
  const legendState = new Map<string, boolean>();
  const isShown = (id: string) => legendState.get(id) ?? true;

  function onVisibilityChange(curveId: string, visible: boolean): void {
    legendState.set(curveId, visible);
  }

  const activeRef = computed(() => {
    const id = store.activeReferenceId;
    return id ? store.references[id] ?? null : null;
  });

  const nyquist = computed(() =>
    Math.max(
      lastFrequency(store.spectrumA?.frequencies),
      lastFrequency(activeRef.value?.spectrum?.frequencies),
      liveFrequencies.value?.at(-1) ?? 0,
      FALLBACK_MAX_FREQ
    )
  );

  const magnitudeRange = computed<[number, number]>(
    () =>
      fixedMagnitudeRange(store.spectrumA, activeRef.value?.spectrum ?? null, liveMagnitudesDb.value) ?? [
        FALLBACK_MIN_VALUE,
        FALLBACK_MAX_VALUE,
      ]
  );

  const irResponse = computed(() => {
    const activeIr = activeRef.value?.ir;
    return activeIr ? irMagnitudeResponse(activeIr) : null;
  });

  /** Symmetric range with headroom for the IR + Graphic EQ curves, in dB either side of 0. */
  const irSpan = computed(() => {
    const response = irResponse.value;
    return response ? Math.max(6, Math.ceil(response.maxAbsDb * 1.15)) : 20;
  });

  function buildLiveCurves(palette: ReturnType<typeof getColorPalette>): PlotCurve[] {
    if (!liveFrequencies.value) return [];
    const curves: PlotCurve[] = [];

    const liveDb =
      liveMagnitudesDb.value ??
      Float32Array.from(liveFrequencies.value.map(() => magnitudeRange.value[0]));
    curves.push({
      type: 'plot',
      id: 'live',
      label: 'Live',
      visible: isShown('live'),
      points: toPoints(liveFrequencies.value, liveDb),
      smoothing: CURVE_SMOOTHING,
      style: {
        draw: 'both',
        line: { color: palette.liveStroke, width: 1.5 },
        fill: { color: palette.liveFill, mode: 'bottom' },
      },
    });

    const averageDb =
      liveAverageDb.value ??
      Float32Array.from(liveFrequencies.value.map(() => magnitudeRange.value[0]));
    curves.push({
      type: 'plot',
      id: 'average',
      label: 'Average',
      visible: isShown('live'),
      points: toPoints(liveFrequencies.value, averageDb),
      smoothing: CURVE_SMOOTHING,
      style: { draw: 'line', line: { color: palette.averageStroke, width: 1.5 } },
    });

    return curves;
  }

  function buildStaticCurves(palette: ReturnType<typeof getColorPalette>): PlotCurve[] {
    const curves: PlotCurve[] = [];
    const A = store.spectrumA;
    const B = activeRef.value?.spectrum ?? null;

    if (A) {
      curves.push({
        type: 'plot',
        id: 'A',
        label: 'A',
        visible: isShown('A'),
        points: toPoints(A.frequencies, A.magnitudesDb),
        smoothing: CURVE_SMOOTHING,
        style: { draw: 'line', line: { color: palette.spectrumA, width: 1 }, animate: true },
      });
    }

    if (B) {
      curves.push({
        type: 'plot',
        id: 'B',
        label: 'B',
        visible: isShown('B'),
        points: toPoints(B.frequencies, B.magnitudesDb),
        smoothing: CURVE_SMOOTHING,
        style: { draw: 'line', line: { color: palette.spectrumB, width: 1 }, animate: true },
      });
    }

    return curves;
  }

  function buildIrCurves(palette: ReturnType<typeof getColorPalette>): Curve[] {
    const active = activeRef.value;
    const response = irResponse.value;
    if (!active?.ir || !response) return [];

    const span = irSpan.value;
    const curves: Curve[] = [];

    const irCurve: PlotCurve = {
      type: 'plot',
      id: 'ir',
      label: 'IR',
      visible: isShown('ir'),
      minValue: -span,
      maxValue: span,
      points: toPoints(response.frequencies, response.magnitudesDb),
      smoothing: CURVE_SMOOTHING,
      style: {
        draw: 'both',
        line: { color: palette.irStroke, width: 1 },
        fill: { color: palette.irFill, mode: 'zero' },
      },
    };
    curves.push(irCurve);

    if (active?.graphicEq.enabled) {
      const eqCurve: EqCurve = {
        type: 'eq',
        id: 'graphicEQ',
        label: 'Graphic EQ',
        visible: isShown('graphicEQ'),
        minGain: -span,
        maxGain: span,
        numbered: true,
        style: { draw: 'line', line: { color: palette.eqStroke, width: 1, dash: 'dotted' } },
        bands: active.graphicEq.bands.map(toEqBand),
      };
      curves.push(eqCurve);
    }

    return curves;
  }

  function toEqBand(band: GraphicEqBand): EqBand {
    return {
      freq: band.frequency,
      gain: band.gain,
      q: band.q,
      type: toPeakType(band.type),
      enabled: band.enabled,
    };
  }

  /**
   * `shallowRef`, not `ref`: curves are always replaced (never mutated in place — see the
   * live-frame and drag-preview watches below), so there's nothing for deep reactivity to
   * buy here, only the cost of proxy-wrapping every point in the IR curve's few-thousand-
   * point array on every rebuild.
   */
  const curves = shallowRef<Curve[]>([]);

  function rebuild(): void {
    const palette = getColorPalette();
    curves.value = [...buildLiveCurves(palette), ...buildStaticCurves(palette), ...buildIrCurves(palette)];
    logger.debug('useFreqPlotCurves', 'Curves rebuilt', { count: curves.value.length });
  }

  rebuild();

  // Full rebuild triggers: a new spectrum, tone curve, or graphic EQ toggle changes
  // which curves exist or how they're shaped.
  watch(
    () => [store.spectrumA, activeRef.value?.spectrum, activeRef.value?.ir, activeRef.value?.graphicEq.enabled],
    rebuild,
    { deep: true }
  );

  // Source switching changes which curves exist at all, so this needs the full rebuild too.
  watch(liveFrequencies, rebuild);

  /**
   * Replaces the named curves with patched copies, reusing every other curve's existing
   * object reference untouched — `Freqplot.setCurves` skips a curve entirely (no redraw,
   * no recompute) when it sees the same reference it already has, so this is what makes a
   * live/drag-preview update cost one redraw for the curve that actually changed rather
   * than a full-canvas redraw of everything on every frame.
   */
  function patchCurves(patches: Record<string, (curve: Curve) => Curve>): void {
    curves.value = curves.value.map((c) => (patches[c.id] ? patches[c.id](c) : c));
  }

  /**
   * Cheap live preview while a band handle is being dragged: recompute the combined curve
   * directly on `toneCurve`'s own grid, skipping the expensive minimum-phase FIR re-render
   * entirely. Once the debounced FIR re-render lands in the store, `ref.ir` changes, the
   * watch above fires, and both curves snap back onto `irMagnitudeResponse`'s own grid — no
   * special "restore" branch needed.
   */
  watch(
    () => {
      const id = store.activeReferenceId;
      return id ? store.references[id]?.graphicEq : null;
    },
    () => {
      const active = activeRef.value;
      if (!active?.toneCurve) return;

      const { frequencies, curveDb } = active.toneCurve;
      const sampleRate = active.ir?.sampleRate ?? store.sampleRateA;
      const eqDb = graphicEqResponseDb(active.graphicEq.bands, frequencies, sampleRate);

      const combinedDb = new Float32Array(curveDb.length);
      for (let i = 0; i < combinedDb.length; i++) {
        combinedDb[i] = curveDb[i] + (active.graphicEq.enabled ? eqDb[i] : 0);
      }

      patchCurves({
        ir: (c) => ({ ...c, points: toPoints(frequencies, combinedDb) }) as PlotCurve,
        graphicEQ: (c) => ({ ...c, bands: active.graphicEq.bands.map(toEqBand) }) as EqCurve,
      });
    },
    { deep: true }
  );

  // Per-frame live update.
  watch(liveMagnitudesDb, (mags) => {
    if (!mags || !liveFrequencies.value) return;
    const freqs = liveFrequencies.value;
    const avg = liveAverageDb.value;
    patchCurves({
      live: (c) => ({ ...c, points: toPoints(freqs, mags) }) as PlotCurve,
      ...(avg ? { average: (c: Curve) => ({ ...c, points: toPoints(freqs, avg) }) as PlotCurve } : {}),
    });
  });

  // Theme changes recolor every curve.
  const currentTheme = ref(getTheme());
  let themeObserver: MutationObserver | null = null;
  if (typeof window !== 'undefined') {
    themeObserver = new MutationObserver(() => {
      const next = getTheme();
      if (next !== currentTheme.value) {
        currentTheme.value = next;
        rebuild();
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  onUnmounted(() => themeObserver?.disconnect());

  /**
   * freqplot's own handle-drag never touches `band.enabled` — only its in-canvas bypass
   * button does. Grabbing a bypassed band's handle should still bring it to life (the
   * point of dragging it in the first place), so a freq/gain change no bypass button click
   * could have caused is treated as an implicit enable; a bypass click (freq/gain
   * unchanged) or a type switch passes `band.enabled` through untouched.
   */
  function onBandChange(_curveId: string, bandIndex: number, band: EqBand): void {
    const storeBand = activeRef.value?.graphicEq.bands[bandIndex];
    if (!storeBand) return;
    const dragged = storeBand.frequency !== band.freq || storeBand.gain !== band.gain;
    store.updateGraphicEqBand(storeBand.id, {
      frequency: band.freq,
      gain: band.gain,
      q: band.q,
      type: toGraphicEqBandType(band.type),
      enabled: dragged ? true : band.enabled,
    });
  }

  return {
    curves,
    minFreq: MIN_PLOT_FREQ,
    maxFreq: nyquist,
    minValue: computed(() => magnitudeRange.value[0]),
    maxValue: computed(() => magnitudeRange.value[1]),
    onVisibilityChange,
    onBandChange,
  };
}
