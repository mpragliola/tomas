<template>
  <div class="waveform-viewer">
    <div v-if="!store.audioBuffers.A || store.audioBuffers.A.length === 0" class="empty-state">
      <p>Load audio files to display waveforms</p>
    </div>

    <div v-else class="waveforms">
      <!-- Waveform A -->
      <div class="waveform-section">
        <div class="waveform-header">
          <label class="waveform-title">Wave 1 (Target)</label>
          <div class="waveform-controls">
            <button @click="resetZoomA" class="btn-sm btn-icon" title="Reset zoom">⟲</button>
          </div>
        </div>
        <div ref="containerA" class="waveform-container"></div>
        <div class="waveform-footer">
          <span class="selection-info">{{ formatSelection(store.selections.A) }}</span>
        </div>
      </div>

      <!-- Waveform B -->
      <div class="waveform-section">
        <div class="waveform-header">
          <label class="waveform-title">Wave 2 (Reference)</label>
          <div class="waveform-controls">
            <button @click="resetZoomB" class="btn-sm btn-icon" title="Reset zoom">⟲</button>
          </div>
        </div>
        <div ref="containerB" class="waveform-container"></div>
        <div class="waveform-footer">
          <span class="selection-info">{{ formatSelection(store.selections.B) }}</span>
        </div>
      </div>

      <!-- Zoom/Pan Controls -->
      <div class="controls">
        <div class="control-group">
          <label class="value-label">Zoom</label>
          <input
            type="range"
            min="1"
            max="100"
            v-model.number="zoomLevel"
            @change="updateZoom"
            class="slider"
          />
          <span class="value">{{ zoomLevel }}%</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';

const store = useAnalysisStore();
const containerA = ref<HTMLElement>();
const containerB = ref<HTMLElement>();
const zoomLevel = ref(100);

let wavesurferA: any = null;
let wavesurferB: any = null;

onMounted(async () => {
  logger.info('WaveformViewer', 'Mounted');
});

onUnmounted(() => {
  if (wavesurferA) wavesurferA.destroy();
  if (wavesurferB) wavesurferB.destroy();
});

function resetZoomA(): void {
  zoomLevel.value = 100;
  updateZoom();
}

function resetZoomB(): void {
  zoomLevel.value = 100;
  updateZoom();
}

function updateZoom(): void {
  const pixelsPerSecond = Math.max(10, 50 * (zoomLevel.value / 100));
  if (wavesurferA) wavesurferA.setOptions({ pixelsPerSecond });
  if (wavesurferB) wavesurferB.setOptions({ pixelsPerSecond });
  logger.debug('WaveformViewer', 'Zoom updated', { level: zoomLevel.value });
}

function formatSelection(selection: any): string {
  if (!selection || selection.endSample === 0) {
    return 'Select region';
  }
  const startSec = (selection.startSample / 44100).toFixed(2);
  const endSec = (selection.endSample / 44100).toFixed(2);
  const durSec = ((selection.endSample - selection.startSample) / 44100).toFixed(2);
  return `${startSec}s - ${endSec}s (${durSec}s)`;
}

watch(
  () => store.audioBuffers.A.length,
  () => {
    logger.debug('WaveformViewer', 'Audio A changed, reinitializing');
  }
);
</script>

<style scoped>
.waveform-viewer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.waveforms {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.waveform-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 120px;
}

.waveform-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.waveform-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.waveform-controls {
  display: flex;
  gap: 4px;
}

.btn-sm {
  padding: 4px 6px;
  font-size: 11px;
}

.btn-icon {
  background-color: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 150ms;
}

.btn-icon:hover {
  background-color: var(--color-border);
  color: var(--color-text-primary);
}

.waveform-container {
  flex: 1;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: rgba(37, 99, 235, 0.02);
  overflow: hidden;
}

.waveform-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  color: var(--color-text-secondary);
}

.selection-info {
  font-family: var(--font-mono);
  font-size: 10px;
}

.controls {
  display: flex;
  gap: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
}

.control-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.control-group input[type="range"] {
  flex: 1;
  min-width: 100px;
}

.value {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-accent);
  min-width: 40px;
  text-align: right;
}

.value-label {
  font-size: 10px;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

:deep(.wavesurfer) {
  border-radius: var(--radius-sm);
}
</style>
