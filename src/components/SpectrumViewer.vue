<template>
  <div class="spectrum-viewer">
    <div class="spectrum-header">
      <div class="spectrum-title-group">
        <h3 class="spectrum-title">Frequency Spectrum</h3>
        <TooltipIcon text="Shows the frequency content of your audio signals. Blue = Source A, Orange = Source B. The derived IR curve appears once computed." />
      </div>
      <div class="spectrum-header-actions">
        <button
          class="btn-expand"
          :class="{ active: activeRef?.graphicEq.enabled }"
          :disabled="!activeRef?.toneCurve"
          :aria-pressed="activeRef?.graphicEq.enabled"
          :title="
            !activeRef?.toneCurve
              ? 'Run a tone-match analysis first'
              : activeRef.graphicEq.enabled
                ? 'Disable graphic EQ'
                : 'Enable graphic EQ'
          "
          @click="store.setGraphicEqEnabled(!activeRef?.graphicEq.enabled)"
        >
          <Icon name="sliders" size="18" />
        </button>
        <button
          class="btn-expand"
          :title="isSpectrumExpanded ? 'Collapse spectrum' : 'Expand spectrum'"
          :aria-label="isSpectrumExpanded ? 'Collapse spectrum viewer' : 'Expand spectrum viewer'"
          :aria-pressed="isSpectrumExpanded"
          @click="onToggleExpand"
        >
          <Icon :name="isSpectrumExpanded ? 'minimize-2' : 'maximize-2'" size="18" />
        </button>
      </div>
    </div>

    <!-- Container stays mounted so the ref is always valid; states overlay it -->
    <div class="plot-area">
      <div ref="plotContainer" class="plot-container"></div>

      <GraphicEqOverlay
        v-if="activeRef?.graphicEq.enabled && activeRef?.toneCurve"
        :plot-container="plotContainer"
        :axis-range="plotAxisRange"
      />

      <Transition name="fade-rise">
        <div v-if="store.isAutoComputing" class="overlay loading-state">
          <div class="spinner"></div>
          <p>Computing spectra...</p>
        </div>
        <div
          v-else-if="!store.spectrumA && !activeRef?.spectrum && !liveFrequencies"
          class="overlay empty-state"
        >
          <p>Compute spectra to display</p>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { useLiveSpectrum } from '../composables/useLiveSpectrum';
import { useSpectrumPlot } from '../composables/useSpectrumPlot';
import { logger } from '../services/logging';
import Icon from './Icon.vue';
import TooltipIcon from './TooltipIcon.vue';
import GraphicEqOverlay from './GraphicEqOverlay.vue';

const store = useAnalysisStore();

interface Props {
  isSpectrumExpanded: boolean;
}

interface Emits {
  (e: 'toggle-expand'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

function onToggleExpand(): void {
  emit('toggle-expand');
}

/** The active reference, or null while nothing is active — the seam every
 * `references[activeReferenceId]` lookup below goes through. */
const activeRef = computed(() => {
  const id = store.activeReferenceId;
  return id ? store.references[id] ?? null : null;
});

const {
  frequencies: liveFrequencies,
  magnitudesDb: liveMagnitudesDb,
  averageDb: liveAverageDb,
} = useLiveSpectrum();

const { plotContainer, scheduleUpdate, handleLiveMagnitudesUpdate, plotAxisRange } = useSpectrumPlot(
  liveFrequencies,
  liveMagnitudesDb,
  liveAverageDb
);

async function resizePlot(): Promise<void> {
  if (!plotContainer.value) return;
  const Plotly = (window as any).Plotly;
  if (Plotly) {
    await Plotly.Plots.resize(plotContainer.value);
  }
}

onMounted(() => {
  logger.info('SpectrumViewer', 'Mounted');
  if (store.spectrumA || activeRef.value?.spectrum || activeRef.value?.ir || liveFrequencies.value) {
    scheduleUpdate();
  }
});

watch(
  () => [store.spectrumA, activeRef.value?.spectrum, activeRef.value?.ir],
  () => scheduleUpdate(),
  { deep: true }
);

// Playback starting, stopping or switching source changes the trace list, so this one
// needs the full rebuild — the frame-by-frame values do not.
watch([liveFrequencies], () => scheduleUpdate());

// Both curves come from the same analyser frame, so one restyle carries the pair — two
// separate calls would redraw the plot twice for a single frame's worth of new data.
watch(liveMagnitudesDb, handleLiveMagnitudesUpdate);

// When the spectrum panel expands/collapses, tell Plotly to resize to the new dimensions
watch(
  () => props.isSpectrumExpanded,
  async () => {
    await scheduleUpdate();
    resizePlot();
  }
);
</script>

<style lang="scss" scoped>
@use '../styles/variables' as *;
@use '../styles/mixins' as *;

$spinner-size: 24px;

.spectrum-viewer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.spectrum-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.spectrum-title-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.spectrum-title {
  margin: 0;
  @include caps-label;
}


.spectrum-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-expand {
  background-color: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: all 200ms ease-out;

  &:hover {
    background-color: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  &:active {
    transform: scale(0.95);
  }

  &.active {
    background-color: color-mix(in srgb, var(--color-accent) 15%, transparent);
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;

    &:hover {
      background-color: var(--color-bg);
      color: var(--color-text-secondary);
      border-color: var(--color-border);
    }
  }

  :deep(.feather-icon) {
    transition: transform 300ms ease-out;
  }
}

.plot-area {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  max-height: 100%;
  align-items: stretch;
  container-type: inline-size;
}

.overlay {
  position: absolute;
  inset: 0;
  background-color: var(--color-bg);
  border-radius: var(--radius-md);
}

.fade-rise-enter-active {
  animation: slideIn $transition-base ease-out;
}

.fade-rise-leave-active {
  transition: opacity $transition-fast;
}

.fade-rise-leave-to {
  opacity: 0;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  gap: 12px;
}

.spinner {
  width: $spinner-size;
  height: $spinner-size;
  border: 2px solid color-mix(in srgb, var(--color-accent) 20%, transparent);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 600ms linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.plot-container {
  flex: 1;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-bg);
  overflow: hidden;
  height: 100%;
  width: 100%;
  align-self: stretch;
}

:deep(.plotly) {
  width: 100%;
  height: 100%;
}
</style>
