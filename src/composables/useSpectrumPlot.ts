import { ref, computed, nextTick, watch, onUnmounted } from 'vue';
import type { Ref } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { irMagnitudeResponse } from '../services/dsp/irResponse';
import { graphicEqResponseDb } from '../services/dsp/graphicEqResponse';
import { fixedMagnitudeRange, lastFrequency } from '../utils/spectrumUtils';
import { logger } from '../services/logging';
import type { FrequencySpectrum } from '../types/spectrum';

const MIN_PLOT_FREQ = 20;
const FALLBACK_FILL_FLOOR_DB = -200;
const FALLBACK_MAX_FREQ = 20000;

export function useSpectrumPlot(
  liveFrequencies: Ref<Float32Array | null>,
  liveMagnitudesDb: Ref<Float32Array | null>,
  liveAverageDb: Ref<Float32Array | null>
) {
  const store = useAnalysisStore();
  const plotContainer = ref<HTMLElement>();

  let plotInitialized = false;
  /** Cached across calls so the per-frame restyle does not go through the dynamic import. */
  let Plotly: any = null;

  const liveName = computed(() => 'Live');

  /**
   * Where the live curve sits in the trace list. The per-frame update is a restyle of
   * this one trace — a full react at 25 fps redraws every static trace as well.
   */
  let liveTraceIndex = -1;
  let averageTraceIndex = -1;
  let differenceTraceIndex = -1;
  let irTraceIndex = -1;
  let graphicEqTraceIndex = -1;

  /**
   * The x log-range and y2 dB span the plot is currently drawn at, so `GraphicEqOverlay`
   * can convert between screen pixels and frequency/gain without reaching into Plotly's
   * own (private, version-fragile) layout internals. Defaults to a sane range before the
   * first plot: the overlay only ever mounts once the active reference's `toneCurve`
   * exists, by which point a real plot has run and this holds real values.
   */
  const plotAxisRange = ref<{ xRange: [number, number]; ySpan: number }>({
    xRange: [Math.log10(MIN_PLOT_FREQ), Math.log10(FALLBACK_MAX_FREQ)],
    ySpan: 20,
  });

  /**
   * What the legend has shown or hidden, keyed by each trace's `meta` identity.
   *
   * Kept here rather than read off the plot alone: a trace that is not currently in the
   * figure has no flag to read, so pausing (which drops the live pair) or clearing a
   * waveform (which drops the IR) would otherwise lose the user's choice and bring the
   * trace back visible when it returns. Hidden is the string 'legendonly', not false,
   * which is why the flag is carried verbatim rather than coerced to a boolean.
   */
  const legendState = new Map<string, unknown>();

  /** Whether the plotly_legendclick listener has been wired to the current graph div. */
  let legendHandlerAttached = false;

  /**
   * Serializes `updatePlot()` calls so a source switch never has two runs racing on the
   * same graph div. Coalesced, not queued one-per-call: bursts of triggers while a run
   * is in flight collapse into a single follow-up run reading the latest state.
   */
  let updateChain: Promise<void> = Promise.resolve();
  let updateQueued = false;

  /**
   * True from the moment `Plotly.newPlot`/`react` is called until its promise settles.
   * The per-frame restyle watcher checks this so a frame arriving mid-redraw does not
   * write into a graph Plotly is still rebuilding.
   */
  let plotBusy = false;

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
        differenceFill: 'rgba(40, 120, 40, 0.3)',
        spectrumA: 'rgba(51, 255, 51, 0.95)',
        spectrumB: 'rgba(34, 153, 34, 0.9)',
        irStroke: 'rgba(85, 170, 85, 0.8)',
        irFill: 'rgba(60, 140, 60, 0.2)',
        eqStroke: 'rgba(100, 200, 100, 0.85)',
      };
    }
    // Default dark theme colors
    return {
      liveStroke: 'rgba(74, 222, 128, 0.9)',
      liveFill: 'rgba(34, 197, 94, 0.18)',
      averageStroke: 'rgba(74, 222, 128, 0.9)',
      differenceFill: 'rgba(234, 179, 8, 0.25)',
      spectrumA: '#2563EB',
      spectrumB: '#FF9500',
      irStroke: 'rgba(139, 92, 246, 0.55)',
      irFill: 'rgba(139, 92, 246, 0.12)',
      eqStroke: 'rgba(6, 214, 160, 0.8)',
    };
  }

  function scheduleUpdate(): void {
    if (updateQueued) return;
    updateQueued = true;
    updateChain = updateChain.then(async () => {
      updateQueued = false;
      await updatePlot();
    });
  }

  /** Fold the legend clicks Plotly wrote onto the live figure into what we remember. */
  function captureLegendState(): void {
    const current = (plotContainer.value as any)?.data;
    if (!Array.isArray(current)) return;
    for (const trace of current) {
      if (typeof trace?.meta === 'string') legendState.set(trace.meta, trace.visible !== 'legendonly');
    }
  }

  /**
   * The live band's legend entry is the only one Plotly draws for the group. This
   * intercepts the click, flips all three related traces together, and cancels Plotly's
   * default single-trace toggle so they cannot land out of sync.
   */
  function attachLegendHandler(): void {
    if (legendHandlerAttached || !plotContainer.value) return;
    legendHandlerAttached = true;

    (plotContainer.value as any).on('plotly_legendclick', (event: any) => {
      if (liveTraceIndex < 0 || event.curveNumber !== liveTraceIndex || !Plotly) return true;

      const current = (plotContainer.value as any).data?.[liveTraceIndex]?.visible;
      const nextVisible = current === 'legendonly' ? true : 'legendonly';
      const indices = [liveTraceIndex - 1, liveTraceIndex, averageTraceIndex, differenceTraceIndex].filter(
        (i) => i >= 0
      );

      Plotly.restyle(plotContainer.value, { visible: nextVisible }, indices);
      legendState.set('live', nextVisible !== 'legendonly');

      // Prevent Plotly's default handling, which would otherwise re-toggle the band
      // trace a second time on top of this.
      return false;
    });
  }

  async function updatePlot(): Promise<void> {
    await nextTick();

    if (!plotContainer.value) {
      plotInitialized = false;
      return;
    }

    try {
      Plotly ??= (await import('plotly.js/dist/plotly')).default;

      // Plotly can't resolve CSS custom properties, so read the app font stack
      const rootStyle = getComputedStyle(document.documentElement);
      const fontFamily = rootStyle.getPropertyValue('--font-body').trim() || 'sans-serif';

      const traces: any[] = [];
      const A = store.spectrumA;
      const activeId = store.activeReferenceId;
      const B = activeId ? store.references[activeId]?.spectrum ?? null : null;

      captureLegendState();
      const isShown = (id: string) => legendState.get(id) ?? true;

      // Pinned, not autoranged: the live curve's peak moves with every frame, and an
      // autoranged axis re-fits to it 25 times a second.
      const yRange = fixedMagnitudeRange(A, B, liveMagnitudesDb.value);

      const nyquist = Math.max(
        lastFrequency(A?.frequencies),
        lastFrequency(B?.frequencies),
        liveFrequencies.value?.at(-1) ?? 0,
        FALLBACK_MAX_FREQ
      );
      const xRange: [number, number] = [Math.log10(MIN_PLOT_FREQ), Math.log10(nyquist)];

      liveTraceIndex = -1;
      averageTraceIndex = -1;
      differenceTraceIndex = -1;
      irTraceIndex = -1;
      graphicEqTraceIndex = -1;

      if (liveFrequencies.value) {
        const floor = yRange ? yRange[0] : FALLBACK_FILL_FLOOR_DB;

        // Plotly only fills to y = 0, which on a dB axis is off the top — a flat trace
        // at the axis floor gives `tonexty` a bottom edge.
        traces.push({
          x: liveFrequencies.value,
          y: liveFrequencies.value.map(() => floor),
          type: 'scatter',
          mode: 'lines',
          line: { width: 0 },
          hoverinfo: 'skip',
          showlegend: false,
          visible: isShown('live'),
        });

        liveTraceIndex = traces.length;
        traces.push({
          x: liveFrequencies.value,
          y: liveMagnitudesDb.value
            ? Array.from(liveMagnitudesDb.value)
            : liveFrequencies.value.map(() => floor),
          type: 'scatter',
          mode: 'lines',
          name: liveName.value,
          meta: 'live',
          visible: isShown('live'),
          line: { width: 0, shape: 'spline', smoothing: 0.6 },
          fill: 'tonexty',
          fillcolor: getColorPalette().liveFill,
          hovertemplate: '<b>Live</b><br>%{x:.1f}Hz<br>%{y:.1f}dB<extra></extra>',
        });

        averageTraceIndex = traces.length;
        traces.push({
          x: liveFrequencies.value,
          y: liveAverageDb.value
            ? Array.from(liveAverageDb.value)
            : liveFrequencies.value.map(() => floor),
          type: 'scatter',
          mode: 'lines',
          showlegend: false,
          visible: isShown('live'),
          line: { color: getColorPalette().averageStroke, width: 1.5, shape: 'spline', smoothing: 0.6 },
          hoverinfo: 'skip',
        });

        // Fill between average line and live curve to highlight unaveraged (fresh) readings.
        differenceTraceIndex = traces.length;
        traces.push({
          x: liveFrequencies.value,
          y: liveMagnitudesDb.value
            ? Array.from(liveMagnitudesDb.value)
            : liveFrequencies.value.map(() => floor),
          type: 'scatter',
          mode: 'lines',
          showlegend: false,
          visible: isShown('live'),
          line: { color: 'transparent' },
          fill: 'tonexty',
          fillcolor: getColorPalette().differenceFill,
          hoverinfo: 'skip',
        });
      }

      if (A) {
        traces.push({
          x: Array.from(A.frequencies),
          y: Array.from(A.magnitudesDb),
          type: 'scatter',
          mode: 'lines',
          name: 'A',
          meta: 'A',
          visible: isShown('A'),
          line: { color: getColorPalette().spectrumA, width: 1 },
          hovertemplate: '<b>A</b><br>%{x:.1f}Hz<br>%{y:.1f}dB<extra></extra>',
        });
      }

      if (B) {
        traces.push({
          x: Array.from(B.frequencies),
          y: Array.from(B.magnitudesDb),
          type: 'scatter',
          mode: 'lines',
          name: 'B',
          meta: 'B',
          visible: isShown('B'),
          line: { color: getColorPalette().spectrumB, width: 1 },
          hovertemplate: '<b>B</b><br>%{x:.1f}Hz<br>%{y:.1f}dB<extra></extra>',
        });
      }

      const activeIr = activeId ? store.references[activeId]?.ir ?? null : null;
      const irResponse = activeIr ? irMagnitudeResponse(activeIr) : null;

      if (irResponse) {
        irTraceIndex = traces.length;
        traces.push({
          x: Array.from(irResponse.frequencies),
          y: Array.from(irResponse.magnitudesDb),
          type: 'scatter',
          mode: 'lines',
          name: 'IR',
          meta: 'IR',
          visible: isShown('IR'),
          yaxis: 'y2',
          line: { color: getColorPalette().irStroke, width: 1 },
          fill: 'tozeroy',
          fillcolor: getColorPalette().irFill,
          hovertemplate: '<b>IR</b><br>%{x:.1f}Hz<br>%{y:+.1f}dB<extra></extra>',
        });

        // The graphic EQ's own shape, shown alongside the combined IR trace above so
        // it's clear what the bands are contributing versus what the tone match found.
        const activeGraphicEq = activeId ? store.references[activeId]?.graphicEq : undefined;
        if (activeGraphicEq?.enabled) {
          graphicEqTraceIndex = traces.length;
          const eqDb = graphicEqResponseDb(activeGraphicEq.bands, irResponse.frequencies, activeIr!.sampleRate);
          traces.push({
            x: Array.from(irResponse.frequencies),
            y: Array.from(eqDb),
            type: 'scatter',
            mode: 'lines',
            name: 'Graphic EQ',
            meta: 'graphicEQ',
            visible: isShown('graphicEQ'),
            yaxis: 'y2',
            line: { color: getColorPalette().eqStroke, width: 1, dash: 'dot' },
            hovertemplate: '<b>Graphic EQ</b><br>%{x:.1f}Hz<br>%{y:+.1f}dB<extra></extra>',
          });
        }
      }

      const theme = getTheme();
      const isRetro = theme === 'retro';
      const axisFontSize = isRetro ? 12 : 10;
      const mainFontSize = isRetro ? 13 : 12;
      const legendFontSize = isRetro ? 12 : 11;

      const layout: any = {
        title: '',
        xaxis: {
          title: { text: 'Frequency (Hz)', font: { family: fontFamily, size: axisFontSize } },
          type: 'log',
          range: xRange,
          autorange: false,
          zeroline: false,
          gridcolor: '#333333',
          tickfont: { family: fontFamily, size: axisFontSize },
          automargin: true,
        },
        yaxis: {
          title: { text: 'Magnitude (dB)', font: { family: fontFamily, size: axisFontSize } },
          ...(yRange ? { range: yRange, autorange: false } : {}),
          zeroline: false,
          gridcolor: '#333333',
          tickfont: { family: fontFamily, size: axisFontSize },
          automargin: true,
          // Locked so a drag-zoom only ever selects a horizontal band on x — Plotly
          // narrows box-zoom to whichever axes aren't fixedrange, and vertical zoom has
          // no reading here worth preserving across a rebuild anyway.
          fixedrange: true,
        },
        plot_bgcolor: 'rgba(26, 26, 26, 0.5)',
        paper_bgcolor: '#1A1A1A',
        font: { family: fontFamily, size: mainFontSize, color: '#E5E5E5' },
        margin: { l: 45, r: 20, t: 20, b: 45 },
        hovermode: 'x unified',
        hoverlabel: { font: { family: fontFamily, size: legendFontSize } },
        showlegend: true,
        legend: {
          xref: 'paper',
          yref: 'paper',
          x: 0.98,
          y: 0.98,
          xanchor: 'right',
          yanchor: 'top',
          orientation: 'h',
          bgcolor: 'rgba(0, 0, 0, 0.55)',
          bordercolor: '#333333',
          borderwidth: 1,
          font: { family: fontFamily, size: legendFontSize, color: '#E5E5E5' },
        },
      };

      // Symmetric range with a little headroom, so 0 dB sits on the middle of the plot.
      // Computed regardless of the IR legend's shown/hidden state — GraphicEqOverlay
      // reads this to place handles, and it must stay stable even if the user has
      // toggled the IR trace's own legend entry off.
      const ySpan = irResponse ? Math.max(6, Math.ceil(irResponse.maxAbsDb * 1.15)) : plotAxisRange.value.ySpan;
      plotAxisRange.value = { xRange, ySpan };

      if (irResponse && isShown('IR')) {
        const span = ySpan;
        const palette = getColorPalette();
        const irAxisColor = isRetro ? 'rgba(85, 170, 85, 0.5)' : 'rgba(139, 92, 246, 0.35)';
        const irTickColor = isRetro ? 'rgba(85, 170, 85, 0.9)' : 'rgba(139, 92, 246, 0.8)';
        layout.yaxis2 = {
          title: { text: 'IR gain (dB)', font: { family: fontFamily, size: axisFontSize } },
          overlaying: 'y',
          side: 'right',
          range: [-span, span],
          showgrid: false,
          zeroline: true,
          zerolinecolor: irAxisColor,
          tickfont: { family: fontFamily, size: axisFontSize, color: irTickColor },
          automargin: true,
          fixedrange: true,
        };
      }

      const config = { responsive: true, displayModeBar: false };

      if (traces.length === 0) {
        if (plotInitialized) {
          Plotly.purge(plotContainer.value);
          plotInitialized = false;
          legendHandlerAttached = false;
          logger.debug('useSpectrumPlot', 'Plot cleared');
        }
      } else if (!plotInitialized) {
        plotBusy = true;
        try {
          await Plotly.newPlot(plotContainer.value, traces, layout, config);
        } finally {
          plotBusy = false;
        }
        plotInitialized = true;
        attachLegendHandler();
        logger.info('useSpectrumPlot', 'Plot initialized');
      } else {
        plotBusy = true;
        try {
          await Plotly.react(plotContainer.value, traces, layout, config);
        } finally {
          plotBusy = false;
        }
        logger.debug('useSpectrumPlot', 'Plot updated');

        // Immediately restyle live curves to fill the gap between this rebuild and the
        // next analyser frame — react() above already carried the values that were
        // current when the rebuild started, so this only matters if a fresher frame
        // landed while react() was in flight and was skipped by the plotBusy guard.
        if (liveTraceIndex >= 0 && liveMagnitudesDb.value) {
          const average = liveAverageDb.value;
          if (average && averageTraceIndex >= 0) {
            await Plotly.restyle(
              plotContainer.value,
              { y: [Array.from(liveMagnitudesDb.value), Array.from(average)] },
              [liveTraceIndex, averageTraceIndex]
            );
          } else {
            await Plotly.restyle(
              plotContainer.value,
              { y: [Array.from(liveMagnitudesDb.value)] },
              [liveTraceIndex]
            );
          }
        }
      }
    } catch (error) {
      logger.error('useSpectrumPlot', 'Plot error', { error: String(error) });
    }
  }

  /**
   * Cheap live preview while a band handle is being dragged: recompute the combined
   * curve directly on `toneCurve`'s own grid and restyle just the IR + Graphic EQ
   * traces, skipping the expensive minimum-phase FIR re-render entirely. Once that
   * debounced re-render lands in the store, the active reference's `ir` changes, the full-rebuild watch
   * in `SpectrumViewer.vue` fires, and both traces snap back onto `irMagnitudeResponse`'s
   * own grid — no special "restore" branch needed here.
   */
  watch(
    // A function re-evaluated on every run, not a snapshot taken at setup time — reading
    // `activeReferenceId` fresh here means switching tabs re-targets this watch at the
    // newly active tab's EQ instead of staying bound to whichever was active when the
    // watch was created.
    () => {
      const id = store.activeReferenceId;
      return id ? store.references[id]?.graphicEq : null;
    },
    () => {
      if (!plotInitialized || plotBusy || !plotContainer.value || !Plotly) return;
      const id = store.activeReferenceId;
      const ref = id ? store.references[id] : null;
      if (!ref?.toneCurve || irTraceIndex < 0) return;

      const { frequencies, curveDb } = ref.toneCurve;
      const eqDb = graphicEqResponseDb(
        ref.graphicEq.bands,
        frequencies,
        ref.ir?.sampleRate ?? store.sampleRateA,
      );

      const combinedDb = new Float32Array(curveDb.length);
      for (let i = 0; i < combinedDb.length; i++) {
        combinedDb[i] = curveDb[i] + (ref.graphicEq.enabled ? eqDb[i] : 0);
      }

      const freqArray = Array.from(frequencies);
      const indices = [irTraceIndex];
      const xUpdate: number[][] = [freqArray];
      const yUpdate: number[][] = [Array.from(combinedDb)];

      if (graphicEqTraceIndex >= 0) {
        indices.push(graphicEqTraceIndex);
        xUpdate.push(freqArray);
        yUpdate.push(Array.from(eqDb));
      }

      Plotly.restyle(plotContainer.value, { x: xUpdate, y: yUpdate }, indices);
    },
    { deep: true },
  );

  function handleLiveMagnitudesUpdate(curve: Float32Array | null): void {
    if (!curve || !plotInitialized || plotBusy || liveTraceIndex < 0 || !plotContainer.value || !Plotly) return;

    const average = liveAverageDb.value;
    if (average && averageTraceIndex >= 0 && differenceTraceIndex >= 0) {
      Plotly.restyle(
        plotContainer.value,
        { y: [Array.from(curve), Array.from(average), Array.from(curve)] },
        [liveTraceIndex, averageTraceIndex, differenceTraceIndex]
      );
      return;
    }

    Plotly.restyle(plotContainer.value, { y: [Array.from(curve)] }, [liveTraceIndex]);
  }

  // Watch for theme changes and redraw with new colors
  const currentTheme = ref(getTheme());
  let themeObserver: MutationObserver | null = null;

  const setupThemeObserver = () => {
    themeObserver = new MutationObserver(() => {
      const newTheme = getTheme();
      if (newTheme !== currentTheme.value) {
        currentTheme.value = newTheme;
        scheduleUpdate();
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  };

  if (typeof window !== 'undefined') {
    setupThemeObserver();
  }

  onUnmounted(() => {
    themeObserver?.disconnect();
  });

  return { plotContainer, scheduleUpdate, handleLiveMagnitudesUpdate, plotAxisRange };
}
