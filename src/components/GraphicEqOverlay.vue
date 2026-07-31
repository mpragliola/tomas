<template>
  <div ref="overlayRoot" class="graphic-eq-overlay">
    <div
      v-for="h in handles"
      :key="h.band.id"
      class="eq-handle"
      :class="{ 'eq-handle--enabled': h.band.enabled }"
      :style="{ left: `${h.x}px`, top: `${h.y}px` }"
      :title="handleTitle(h.band)"
      @pointerdown="onPointerDown($event, h.band)"
      @wheel.prevent="onWheel($event, h.band)"
      @dblclick.prevent="resetBand(h.band, h.number - 1)"
    >{{ h.number }}</div>

    <GraphicEqBandPopover
      v-if="activeBand"
      :band="activeBand"
      :anchor="popoverAnchor!"
      @close="closePopover"
      @update="(partial) => store.updateGraphicEqBand(activeBand!.id, partial)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import {
  GRAPHIC_EQ_GAIN_RANGE_DB,
  GRAPHIC_EQ_Q_RANGE,
  GRAPHIC_EQ_FREQUENCIES,
  DEFAULT_BAND_Q,
} from '../types/graphicEq';
import type { GraphicEqBand } from '../types/graphicEq';
import GraphicEqBandPopover from './GraphicEqBandPopover.vue';

interface Props {
  plotContainer: HTMLElement | undefined;
  axisRange: { xRange: [number, number]; ySpan: number };
}

const props = defineProps<Props>();
const store = useAnalysisStore();

/** The active reference, or null while nothing is active — the one seam every
 * `references[activeReferenceId]` lookup below goes through. */
const activeRef = computed(() => {
  const id = store.activeReferenceId;
  return id ? store.references[id] ?? null : null;
});

const overlayRoot = ref<HTMLElement>();

/**
 * Bumped whenever the plot might have moved or resized, so `handles` recomputes.
 * Positioning itself always reads live state at bump time (see `dataToPixel`) rather
 * than caching anything here — this ref exists purely to trigger that recompute.
 */
const repositionTick = ref(0);
function requestReposition(): void {
  repositionTick.value++;
}

let resizeObserver: ResizeObserver | null = null;
function observe(el: HTMLElement | undefined): void {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (!el) return;
  resizeObserver = new ResizeObserver(requestReposition);
  resizeObserver.observe(el);
}

/**
 * `ResizeObserver` alone repositions too early on a window resize: Plotly's own
 * `responsive: true` handling recomputes `_fullLayout` (new axis `_offset`/`_length`)
 * asynchronously, and our observer firing first would read the stale, pre-resize axis
 * geometry — misaligning every handle until some *later* update happened to trigger a
 * recompute. `plotly_afterplot` fires once Plotly has actually finished redrawing
 * (including a responsive resize), so it's the correct, race-free trigger; the observer
 * stays only as a fallback for CSS-driven layout shifts Plotly itself never sees.
 */
let plotlyListenerAttached = false;
function attachPlotlyListener(): void {
  if (plotlyListenerAttached) return;
  const el = props.plotContainer as any;
  if (!el?.on) return;
  el.on('plotly_afterplot', requestReposition);
  plotlyListenerAttached = true;
}
function detachPlotlyListener(): void {
  const el = props.plotContainer as any;
  if (plotlyListenerAttached && el?.removeListener) el.removeListener('plotly_afterplot', requestReposition);
  plotlyListenerAttached = false;
}

onMounted(() => {
  observe(props.plotContainer);
  attachPlotlyListener();
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  detachPlotlyListener();
});
watch(() => props.plotContainer, (el) => {
  observe(el);
  detachPlotlyListener();
  attachPlotlyListener();
  requestReposition();
});
// `axisRange` changes every time `useSpectrumPlot` finishes a plot rebuild — a reliable
// "Plotly just initialized/redrew" signal to retry attaching on, for the case where this
// overlay mounts before the very first `Plotly.newPlot` has resolved.
watch(() => props.axisRange, () => { attachPlotlyListener(); requestReposition(); }, { deep: true });

const BORDER_WIDTH = 1; // .plot-container's `border: 1px solid`, see SpectrumViewer.vue

/**
 * Plotly attaches `_fullLayout` (with live `xaxis`/`yaxis2`, each exposing `d2p`/`p2d`
 * pixel<->data conversion) directly onto the div passed to `newPlot` — i.e. onto
 * `plotContainer` itself. This is unexported/private API, but it is the only source that
 * accounts for `automargin: true` shifting the actual plot margins away from their
 * nominal values (e.g. wider y-axis labels pushing the plot area over) — a fixed-margin
 * calculation would drift out of sync with the real chart whenever that happens.
 */
function plotlyAxes(): { x: any; y: any } | null {
  const layout = (props.plotContainer as any)?._fullLayout;
  if (!layout?.xaxis?.d2p || !layout?.yaxis2?.d2p) return null;
  return { x: layout.xaxis, y: layout.yaxis2 };
}

function containerOffset(): { left: number; top: number } {
  const el = props.plotContainer;
  return {
    left: (el?.offsetLeft ?? 0) + BORDER_WIDTH,
    top: (el?.offsetTop ?? 0) + BORDER_WIDTH,
  };
}

/** Frequency/gain -> pixel position relative to this component's own root element. */
function dataToPixel(frequency: number, gainDb: number): { x: number; y: number } {
  const { left, top } = containerOffset();
  const axes = plotlyAxes();
  if (axes) {
    // `d2p`/`p2d` are local to the axis's own drawing rectangle — they do NOT include
    // `_offset` (the margin-driven pixel offset from the plot div's own origin), verified
    // empirically against Plotly's actual rendered tick positions. Without adding it back,
    // handles land a full margin-width (~45px) away from where the curve is actually drawn.
    return {
      x: left + axes.x._offset + axes.x.d2p(frequency),
      y: top + axes.y._offset + axes.y.d2p(gainDb),
    };
  }

  // Plotly hasn't painted yet (or a future version drops `_fullLayout`) — approximate
  // with the plot's nominal, non-automargin-adjusted geometry rather than render nothing.
  const el = props.plotContainer;
  const { xRange, ySpan } = props.axisRange;
  const width = el?.clientWidth ?? 0;
  const height = el?.clientHeight ?? 0;
  const fracX = (Math.log10(Math.max(frequency, 1)) - xRange[0]) / (xRange[1] - xRange[0]);
  const fracY = (ySpan - gainDb) / (2 * ySpan);
  return { x: left + fracX * width, y: top + fracY * height };
}

/** Inverse of `dataToPixel` — pixel position (relative to this root) -> frequency/gain. */
function pixelToData(x: number, y: number): { frequency: number; gain: number } {
  const { left, top } = containerOffset();
  const axes = plotlyAxes();
  if (axes) {
    return {
      frequency: axes.x.p2d(x - left - axes.x._offset),
      gain: axes.y.p2d(y - top - axes.y._offset),
    };
  }

  const el = props.plotContainer;
  const { xRange, ySpan } = props.axisRange;
  const width = el?.clientWidth || 1;
  const height = el?.clientHeight || 1;
  const fracX = (x - left) / width;
  const fracY = (y - top) / height;
  return {
    frequency: Math.pow(10, xRange[0] + fracX * (xRange[1] - xRange[0])),
    gain: ySpan - fracY * 2 * ySpan,
  };
}

const handles = computed(() => {
  void repositionTick.value; // dependency only — see `requestReposition`
  // Bands never reorder in the store (only their fields mutate via id-matched .map()),
  // so numbering by array position is stable even after a handle's frequency is dragged
  // past a neighbor's.
  return (activeRef.value?.graphicEq.bands ?? []).map((band, index) => {
    const { x, y } = dataToPixel(band.frequency, band.gain);
    return { band, x, y, number: index + 1 };
  });
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nyquist(): number {
  return (activeRef.value?.ir?.sampleRate ?? store.sampleRateA ?? 44100) / 2;
}

function handleTitle(band: GraphicEqBand): string {
  const freq = band.frequency >= 1000 ? `${(band.frequency / 1000).toFixed(1)}k` : `${band.frequency}`;
  const status = band.enabled ? '' : ' (bypassed)';
  return `${band.type} · ${freq}Hz · ${band.gain >= 0 ? '+' : ''}${band.gain.toFixed(1)}dB · Q ${band.q.toFixed(2)}${status}`;
}

const DRAG_THRESHOLD_PX = 4;

function onPointerDown(event: PointerEvent, band: GraphicEqBand): void {
  event.preventDefault();
  event.stopPropagation();

  const target = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;

  const onMove = (e: PointerEvent): void => {
    if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return;
    moved = true;

    const rootRect = overlayRoot.value!.getBoundingClientRect();
    const { frequency, gain } = pixelToData(e.clientX - rootRect.left, e.clientY - rootRect.top);

    store.updateGraphicEqBand(band.id, {
      frequency: clamp(frequency, 20, nyquist()),
      gain: clamp(gain, GRAPHIC_EQ_GAIN_RANGE_DB[0], GRAPHIC_EQ_GAIN_RANGE_DB[1]),
      enabled: true,
    });
  };

  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (!moved) openPopover(band, target);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/** Double-click restores a band to its untouched default — bypassed, 0dB, default Q/type. */
function resetBand(band: GraphicEqBand, index: number): void {
  store.updateGraphicEqBand(band.id, {
    frequency: GRAPHIC_EQ_FREQUENCIES[index],
    gain: 0,
    q: DEFAULT_BAND_Q,
    type: 'peaking',
    enabled: false,
  });
}

function onWheel(event: WheelEvent, band: GraphicEqBand): void {
  const delta = event.deltaY !== 0 ? -event.deltaY : event.deltaX;
  if (delta === 0) return;

  // Multiplicative base (Q is a ratio), with the per-tick percentage itself growing
  // mildly toward the top of the range (5% near the bottom, ~9% near 15) — a flat
  // percentage takes the same number of ticks to double regardless of where you are,
  // which reads as the wheel "not speeding up" even though steps are already growing
  // in absolute terms; ramping the percentage too makes the top of the range reachable
  // without an excessive number of ticks.
  const t = clamp((band.q - GRAPHIC_EQ_Q_RANGE[0]) / (GRAPHIC_EQ_Q_RANGE[1] - GRAPHIC_EQ_Q_RANGE[0]), 0, 1);
  const pct = 0.05 + 0.04 * t;
  const q = clamp(band.q * Math.pow(1 + pct, Math.sign(delta)), GRAPHIC_EQ_Q_RANGE[0], GRAPHIC_EQ_Q_RANGE[1]);
  store.updateGraphicEqBand(band.id, { q, enabled: true });
}

const activeBandId = ref<string | null>(null);
const popoverAnchor = ref<DOMRect | null>(null);

const activeBand = computed<GraphicEqBand | null>(() =>
  activeBandId.value ? activeRef.value?.graphicEq.bands.find((b) => b.id === activeBandId.value) ?? null : null,
);

function openPopover(band: GraphicEqBand, anchorEl: HTMLElement): void {
  activeBandId.value = band.id;
  popoverAnchor.value = anchorEl.getBoundingClientRect();
}

function closePopover(): void {
  activeBandId.value = null;
  popoverAnchor.value = null;
}
</script>

<style lang="scss" scoped>
@use '../styles/variables' as *;

.graphic-eq-overlay {
  position: absolute;
  inset: 0;
  // The plot beneath still needs its own hover/zoom interactions; only the handles
  // themselves (and the popover, teleported out of this tree) should capture pointer input.
  pointer-events: none;
}

.eq-handle {
  position: absolute;
  width: 19px;
  height: 19px;
  margin-left: -9.5px;
  margin-top: -9.5px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background-color: color-mix(in srgb, var(--color-text-secondary) 60%, transparent);
  border: 1px solid var(--color-bg);
  box-shadow: 0 0 0 1px var(--color-border);
  color: var(--color-bg);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  user-select: none;
  // The two-axis drag (frequency + gain at once) reads better as a four-way move
  // cursor than a hand grab, which implies a single-axis or whole-canvas pan.
  cursor: move;
  pointer-events: auto;
  touch-action: none;
  opacity: 0.5;
  transition: opacity 150ms ease-out, background-color 150ms ease-out;

  // Generous invisible hit-padding, so the handle stays easy to grab and wheel over
  // even when the plot is small (collapsed spectrum, narrow container).
  &::before {
    content: '';
    position: absolute;
    inset: -10px;
  }

  &:hover,
  &:active {
    opacity: 0.85;
  }

  &--enabled {
    background-color: var(--color-accent);
    opacity: 1;

    &:hover,
    &:active {
      opacity: 1;
    }
  }
}
</style>
