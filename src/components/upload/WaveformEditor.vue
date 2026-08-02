<template>
  <!-- Stays mounted (v-show) so the waver ref is always valid -->
  <div v-show="active" class="loaded-state">
    <Waver
      ref="waverRef"
      :height="130"
      :theme="theme"
      :view-mode="view"
      show-zero-line
      show-minimap
      :show-load-button="false"
      :show-record-button="false"
      class="waveform-host"
      @selectionchange="onSelectionChange"
      @cursorchange="onCursorChange"
    />

    <div class="waveform-footer">
      <span class="duration">{{ durationLabel }}</span>
      <span class="selection-info">{{ selectionLabel }}</span>
    </div>

    <div class="waveform-tools">
      <button
        type="button"
        class="tool-btn"
        :title="view === 'waveform' ? 'Show spectrogram' : 'Show waveform'"
        @click.stop="view = view === 'waveform' ? 'spectrogram' : 'waveform'"
      >
        <Icon :name="view === 'waveform' ? 'bar-chart-2' : 'activity'" size="14" />
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
import { computed, ref } from 'vue';
import { Waver } from 'waver/vue';
import type { ViewMode } from 'waver';
import Icon from '../Icon.vue';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useSpectrumScheduler } from '../../composables/useSpectrumScheduler';
import { useWaveformSlot, type WaveformTarget, type WaverHandle } from '../../composables/useWaveformSlot';

const props = defineProps<{
  target: WaveformTarget;
  /** The block is laid out and can be measured. */
  active: boolean;
}>();

const emit = defineEmits<{
  /** For A: clear the loaded file. For a reference tab: remove that tab. Meaning is
   * resolved by the caller (AudioSlot.vue / ReferenceSlot.vue), not baked in here. */
  clear: [];
  status: [message: string, durationMs: number];
}>();

const store = useAnalysisStore();
const waverRef = ref<WaverHandle>();
/** Which of waver's two stacked views is on top. */
const view = ref<ViewMode>('waveform');

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

const { theme, resetView, onSelectionChange, onCursorChange } = useWaveformSlot(
  () => props.target,
  waverRef,
  {
    active: computed(() => props.active),
    onStatus: (message, durationMs) => emit('status', message, durationMs),
    onSelectionChange: spectrum.schedule,
  },
);

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

.waveform-host {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
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
</style>
