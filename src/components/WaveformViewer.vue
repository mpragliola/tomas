<template>
  <div class="waveform-viewer">
    <!-- Containers stay mounted so the refs are always valid; states overlay them -->
    <div class="waveforms">
      <!-- Waveform A -->
      <div class="waveform-section">
        <div class="waveform-header">
          <label class="waveform-title">Wave 1 (Target)</label>
          <div class="waveform-controls">
            <button @click="resetZoom" class="btn-sm btn-icon" title="Reset zoom">⟲</button>
          </div>
        </div>
        <div class="waveform-area">
          <div ref="containerA" class="waveform-container"></div>
          <div v-if="store.audioBuffers.A.length === 0" class="overlay">
            <p>Load Wave 1 to display</p>
          </div>
        </div>
        <div class="waveform-footer">
          <span class="selection-info">{{ formatSelection('A') }}</span>
        </div>
      </div>

      <!-- Waveform B -->
      <div class="waveform-section">
        <div class="waveform-header">
          <label class="waveform-title">Wave 2 (Reference)</label>
          <div class="waveform-controls">
            <button @click="resetZoom" class="btn-sm btn-icon" title="Reset zoom">⟲</button>
          </div>
        </div>
        <div class="waveform-area">
          <div ref="containerB" class="waveform-container"></div>
          <div v-if="store.audioBuffers.B.length === 0" class="overlay">
            <p>Load Wave 2 to display</p>
          </div>
        </div>
        <div class="waveform-footer">
          <span class="selection-info">{{ formatSelection('B') }}</span>
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
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';

const store = useAnalysisStore();
const containerA = ref<HTMLElement>();
const containerB = ref<HTMLElement>();
const zoomLevel = ref(100);

const instances: Record<'A' | 'B', any> = { A: null, B: null };

const waveColors = {
  A: { progressColor: '#2563EB', cursorColor: '#2563EB' },
  B: { progressColor: '#FF9500', cursorColor: '#FF9500' },
};

onMounted(() => {
  logger.info('WaveformViewer', 'Mounted');
  // Initialize waveforms when store updates
  watch(() => store.audioBuffers.A.length, () => initWaveform('A'), { immediate: true });
  watch(() => store.audioBuffers.B.length, () => initWaveform('B'), { immediate: true });
});

onUnmounted(() => {
  destroyWaveform('A');
  destroyWaveform('B');
});

function destroyWaveform(slot: 'A' | 'B'): void {
  if (!instances[slot]) return;
  try {
    instances[slot].destroy();
  } catch (error) {
    logger.debug('WaveformViewer', `Destroy ${slot} failed`, { error: String(error) });
  }
  instances[slot] = null;
}

async function initWaveform(slot: 'A' | 'B'): Promise<void> {
  // Let any pending render flush before touching the container
  await nextTick();

  const container = slot === 'A' ? containerA.value : containerB.value;
  if (!container) return;

  destroyWaveform(slot);

  const audioData = store.audioBuffers[slot];
  if (audioData.length === 0) return;

  try {
    const WaveSurfer = (await import('wavesurfer.js')).default;
    const sampleRate = store.sampleRates[slot];

    // wavesurfer 7 renders straight from pre-computed peaks — no media element needed
    instances[slot] = WaveSurfer.create({
      container,
      waveColor: '#2C2C2C',
      ...waveColors[slot],
      height: 80,
      normalize: true,
      peaks: [audioData],
      duration: audioData.length / sampleRate,
    });

    logger.info('WaveformViewer', `Waveform ${slot} initialized`, {
      samples: audioData.length,
      sampleRate,
    });
  } catch (error) {
    logger.error('WaveformViewer', `Failed to init waveform ${slot}`, { error: String(error) });
  }
}

function resetZoom(): void {
  zoomLevel.value = 100;
  updateZoom();
}

function updateZoom(): void {
  const minPxPerSec = Math.max(10, 50 * (zoomLevel.value / 100));
  for (const slot of ['A', 'B'] as const) {
    if (instances[slot]) instances[slot].setOptions({ minPxPerSec });
  }
  logger.debug('WaveformViewer', 'Zoom updated', { level: zoomLevel.value });
}

function formatSelection(slot: 'A' | 'B'): string {
  const selection = store.selections[slot];
  if (!selection || selection.endSample === 0) {
    return 'Select region';
  }
  const sampleRate = store.sampleRates[slot];
  const startSec = (selection.startSample / sampleRate).toFixed(2);
  const endSec = (selection.endSample / sampleRate).toFixed(2);
  const durSec = ((selection.endSample - selection.startSample) / sampleRate).toFixed(2);
  return `${startSec}s - ${endSec}s (${durSec}s)`;
}
</script>

<style scoped>
.waveform-viewer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.waveform-area {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: 12px;
}

.waveforms {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
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
