<template>
  <!-- Stays mounted (v-show) so the container ref is always valid for WaveSurfer -->
  <div v-show="active" class="loaded-state">
    <div
      class="waveform-minimap-group"
      :class="{ 'view-hidden': view !== 'wave' }"
      :style="{ order: view === 'wave' ? 1 : 3 }"
    >
      <div
        ref="container"
        class="waveform-container"
        @wheel="handleWheel"
      >
        <div
          v-show="scrollBar.visible"
          class="scroll-overlay"
          :style="{ left: scrollBar.left + '%', width: scrollBar.width + '%' }"
          @pointerdown="startScrollDrag"
        ></div>
      </div>

      <!-- Plugin hosts: kept outside .waveform-container so the shadow-root scrollbar
           lookup and the crosshair cursor rule keep matching only the waveform.
           Hidden views collapse height only — width must stay measurable, or the
           plugin renders into a zero-width canvas the next time it's shown. The active
           view is reordered above the minimap, so the two views swap position instead
           of the spectrogram always trailing it. -->
      <div ref="minimapContainer" class="minimap-container"></div>
    </div>
    <div
      ref="spectrogramContainer"
      class="spectrogram-container"
      :class="{ 'view-hidden': view !== 'spectrogram' }"
      :style="{ order: view === 'spectrogram' ? 1 : 3 }"
    ></div>

    <div class="waveform-footer" style="order: 4">
      <span class="duration">{{ durationLabel }}</span>
      <span class="selection-info">{{ selectionLabel }}</span>
    </div>

    <div class="waveform-tools" style="order: 5">
      <input
        type="range"
        class="zoom-slider"
        :min="ZOOM_MIN"
        :max="ZOOM_MAX"
        step="0.5"
        :value="zoom"
        @input="setZoom(Number(($event.target as HTMLInputElement).value))"
        title="Zoom"
      />
      <button
        type="button"
        class="tool-btn"
        :title="view === 'wave' ? 'Show spectrogram' : 'Show waveform'"
        @click.stop="view = view === 'wave' ? 'spectrogram' : 'wave'"
      >
        <Icon :name="view === 'wave' ? 'bar-chart-2' : 'activity'" size="14" />
      </button>
      <button
        type="button"
        class="tool-btn"
        title="Reset zoom & selection"
        @click.stop="resetView"
      >
        <Icon name="rotate-ccw" size="14" />
      </button>
      <button type="button" class="cancel-btn" title="Remove file" aria-label="Remove file" @click.stop="emit('clear')">
        <Icon name="x" size="16" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import Icon from '../Icon.vue';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useSpectrumScheduler } from '../../composables/useSpectrumScheduler';
import { useWaveformSlot, ZOOM_MIN, ZOOM_MAX, type WaveformTarget } from '../../composables/useWaveformSlot';

const props = defineProps<{
  target: WaveformTarget;
  /** The block is laid out and can be measured — see useWaveformSlot. */
  active: boolean;
}>();

const emit = defineEmits<{
  /** For A: clear the loaded file. For a reference tab: remove that tab. Meaning is
   * resolved by the caller (AudioSlot.vue / ReferenceSlot.vue), not baked in here. */
  clear: [];
  status: [message: string, durationMs: number];
}>();

const store = useAnalysisStore();
const container = ref<HTMLElement>();
const minimapContainer = ref<HTMLElement>();
const spectrogramContainer = ref<HTMLElement>();
/** Which of the two stacked views is on top — the other collapses to free up height. */
const view = ref<'wave' | 'spectrogram'>('wave');
// Passed as getters, not `props.target` itself: this component instance is reused across
// reference tab switches (only the `target` prop's value changes), and a composable's
// setup runs once — a raw value would freeze on whichever tab was active at first mount.
const spectrum = useSpectrumScheduler(() => props.target, {
  // A selection the FFT refuses is otherwise indistinguishable from a selection
  // that worked — the region is drawn either way and nothing downstream moves
  onError: (message) => emit('status', message, 3000),
  // Empty clears — a refusal must not outlive the selection that fixed it
  onSuccess: () => emit('status', '', 0),
});

const { zoom, scrollBar, repaint, setZoom, handleWheel, startScrollDrag, resetView } =
  useWaveformSlot(() => props.target, container, {
    active: toRef(props, 'active'),
    minimapContainer,
    spectrogramContainer,
    onStatus: (message, durationMs) => emit('status', message, durationMs),
    onSelectionChange: spectrum.schedule,
  });

/** Same seam useWaveformSlot uses internally — resolve buffer/rate/selection for
 * whichever target this instance is showing. */
function resolveTarget() {
  if (props.target === 'A') {
    return {
      buffer: store.audioBufferA,
      sampleRate: store.sampleRateA,
      selection: store.selectionA,
    };
  }
  const reference = store.references[props.target.referenceId];
  const asset = reference?.assetId ? store.audioAssets[reference.assetId] : undefined;
  return {
    buffer: asset?.buffer ?? new Float32Array(),
    sampleRate: asset?.sampleRate ?? 44100,
    selection: reference?.selection ?? null,
  };
}

const durationLabel = computed(() => {
  const { buffer, sampleRate } = resolveTarget();
  if (buffer.length === 0) return '0.00s';
  return `${(buffer.length / sampleRate).toFixed(2)}s`;
});

const selectionLabel = computed(() => {
  const { selection, sampleRate } = resolveTarget();
  if (!selection || selection.endSample <= selection.startSample) return 'drag to select';
  const start = (selection.startSample / sampleRate).toFixed(2);
  const end = (selection.endSample / sampleRate).toFixed(2);
  return `${start}s – ${end}s`;
});

</script>

<style lang="scss" scoped>
@use '../../styles/variables' as *;

$icon-btn-size: 28px;

@mixin icon-btn {
  background-color: var(--color-bg);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all $transition-fast;
  display: flex;
  align-items: center;
  justify-content: center;
  width: $icon-btn-size;
  height: $icon-btn-size;
  flex-shrink: 0;
}

.loaded-state {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.waveform-minimap-group {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.waveform-container {
  position: relative;
  background-color: color-mix(in srgb, var(--color-accent) 2%, transparent);
  overflow: hidden;

  :deep(> div) { cursor: crosshair; }
}

/* Sits on top of the waveform instead of stealing height from it */
.scroll-overlay {
  position: absolute;
  bottom: 3px;
  height: 5px;
  z-index: 10;
  min-width: 16px;
  border-radius: $radius-pill;
  background-color: rgba(140, 140, 140, 0.45);
  cursor: grab;
  transition: background-color $transition-fast;

  &:hover,
  &:active { background-color: rgba(160, 160, 160, 0.8); }
}

/* The minimap strip collapses to nothing until its plugin fills it */
.minimap-container {
  position: relative;
  overflow: hidden;

  &:not(:empty) {
    flex-shrink: 0;
    border-top: 1px solid var(--color-border);
  }
}

/* Same box model as .waveform-container — height swap on toggle doesn't jitter */
.spectrogram-container {
  position: relative;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

/* Inactive view: zero height but measurable width for the plugin */
.waveform-minimap-group,
.spectrogram-container {
  &.view-hidden {
    height: 0;
    border: none;
    margin: 0;
    overflow: hidden;
  }
}

.waveform-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border);
}

.duration {
  font-family: var(--font-body);
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
}

.selection-info {
  font-family: var(--font-body);
  font-size: var(--font-size-label);
  color: var(--color-accent);
  white-space: nowrap;
}

.waveform-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}

.zoom-slider {
  flex: 1;
  min-width: 0;
  height: 4px;
}

.tool-btn {
  @include icon-btn;

  &:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  &.active {
    border-color: var(--color-accent);
    color: var(--color-accent);
    background-color: color-mix(in srgb, var(--color-accent) 15%, transparent);
  }
}

.cancel-btn {
  @include icon-btn;
  padding: 4px 8px;
  font-size: var(--font-size-base);

  &:hover {
    border-color: var(--color-error);
    color: var(--color-error);
    background-color: color-mix(in srgb, var(--color-error) 5%, transparent);
  }
}

:deep(.wavesurfer) {
  border-radius: var(--radius-sm);
}
</style>
