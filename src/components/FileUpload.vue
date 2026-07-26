<template>
  <div class="file-upload">
    <div class="section">
      <div class="section-header">
        <label class="section-title">Wave 1 (A — your sound)</label>
      </div>
      <div
        class="upload-area"
        :class="{ active: dragActiveA, loaded: fileA }"
        @dragover.prevent="dragActiveA = true"
        @dragenter.prevent="dragActiveA = true"
        @dragleave="dragActiveA = false"
        @drop.prevent="handleDrop($event, 'A')"
      >
        <input
          ref="inputA"
          type="file"
          accept=".wav"
          @change="handleFileSelect($event, 'A')"
          style="display: none"
        />

        <!-- Loading state -->
        <div v-if="loadingA" class="loading-state">
          <div class="spinner"></div>
          <p class="loading-text">Loading...</p>
        </div>

        <!-- Loaded state with waveform -->
        <div v-else-if="fileA" class="loaded-state">
          <div ref="containerA" class="waveform-container"></div>
          <div class="waveform-footer">
            <span class="duration">{{ formatDuration('A') }}</span>
            <button type="button" class="cancel-btn" @click.stop="clearFile('A')">✕</button>
          </div>
        </div>

        <!-- Empty state with load and record buttons -->
        <div v-else class="empty-state">
          <div class="buttons-row">
            <button type="button" class="action-button" @click="inputA?.click()">
              📁 Load File
            </button>
            <button type="button" class="action-button record" @click="emitRecord('A')">
              ● Record
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="section">
      <div class="section-header">
        <label class="section-title">Wave 2 (B — reference tone)</label>
      </div>
      <div
        class="upload-area"
        :class="{ active: dragActiveB, loaded: fileB }"
        @dragover.prevent="dragActiveB = true"
        @dragenter.prevent="dragActiveB = true"
        @dragleave="dragActiveB = false"
        @drop.prevent="handleDrop($event, 'B')"
      >
        <input
          ref="inputB"
          type="file"
          accept=".wav"
          @change="handleFileSelect($event, 'B')"
          style="display: none"
        />

        <!-- Loading state -->
        <div v-if="loadingB" class="loading-state">
          <div class="spinner"></div>
          <p class="loading-text">Loading...</p>
        </div>

        <!-- Loaded state with waveform -->
        <div v-else-if="fileB" class="loaded-state">
          <div ref="containerB" class="waveform-container"></div>
          <div class="waveform-footer">
            <span class="duration">{{ formatDuration('B') }}</span>
            <button type="button" class="cancel-btn" @click.stop="clearFile('B')">✕</button>
          </div>
        </div>

        <!-- Empty state with load and record buttons -->
        <div v-else class="empty-state">
          <div class="buttons-row">
            <button type="button" class="action-button" @click="inputB?.click()">
              📁 Load File
            </button>
            <button type="button" class="action-button record" @click="emitRecord('B')">
              ● Record
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Status Message -->
    <div v-if="statusMessage" class="status-message">
      {{ statusMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';

const store = useAnalysisStore();
const inputA = ref<HTMLInputElement>();
const inputB = ref<HTMLInputElement>();
const containerA = ref<HTMLElement>();
const containerB = ref<HTMLElement>();
const fileA = ref<File | null>(null);
const fileB = ref<File | null>(null);
const dragActiveA = ref(false);
const dragActiveB = ref(false);
const loadingA = ref(false);
const loadingB = ref(false);
const statusMessage = ref('');

const waveInstances: Record<'A' | 'B', any> = { A: null, B: null };

const waveColors = {
  A: { progressColor: '#2563EB', cursorColor: '#2563EB' },
  B: { progressColor: '#FF9500', cursorColor: '#FF9500' },
};

const emit = defineEmits<{
  'file-loaded': [{ slot: 'A' | 'B'; file: File }];
  'record': [{ slot: 'A' | 'B' }];
}>();

onMounted(() => {
  watch(() => store.audioBuffers.A.length, () => initWaveform('A'), { immediate: true });
  watch(() => store.audioBuffers.B.length, () => initWaveform('B'), { immediate: true });
});

onUnmounted(() => {
  destroyWaveform('A');
  destroyWaveform('B');
});

async function handleFileSelect(event: Event, slot: 'A' | 'B'): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (files && files.length > 0) {
    await loadFile(files[0], slot);
  }
}

async function handleDrop(event: DragEvent, slot: 'A' | 'B'): Promise<void> {
  if (slot === 'A') dragActiveA.value = false;
  if (slot === 'B') dragActiveB.value = false;

  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = Array.from(files).find((f) => f.type === 'audio/wav' || f.name.endsWith('.wav'));
    if (file) {
      await loadFile(file, slot);
    } else {
      logger.warn('FileUpload', 'Dropped file is not a WAV file');
    }
  }
}

async function loadFile(file: File, slot: 'A' | 'B'): Promise<void> {
  // Validate file type
  if (!file.name.endsWith('.wav')) {
    const error = `Invalid file type. Expected .wav, got ${file.name.split('.').pop() || 'unknown'}`;
    logger.warn('FileUpload', error, { fileName: file.name });
    statusMessage.value = error;
    setTimeout(() => { statusMessage.value = ''; }, 3000);
    return;
  }

  // Validate file size
  const MAX_SIZE = 100 * 1024 * 1024; // 100MB
  if (file.size === 0) {
    const error = 'File is empty';
    logger.warn('FileUpload', error);
    statusMessage.value = error;
    setTimeout(() => { statusMessage.value = ''; }, 3000);
    return;
  }

  if (file.size > MAX_SIZE) {
    const error = `File too large. Max 100MB, got ${(file.size / 1024 / 1024).toFixed(1)}MB`;
    logger.warn('FileUpload', error, { size: file.size });
    statusMessage.value = error;
    setTimeout(() => { statusMessage.value = ''; }, 3000);
    return;
  }

  const isSlotA = slot === 'A';
  try {
    if (isSlotA) {
      loadingA.value = true;
    } else {
      loadingB.value = true;
    }

    await store.loadFile(file, slot);

    if (isSlotA) {
      fileA.value = file;
    } else {
      fileB.value = file;
    }

    emit('file-loaded', { slot, file });
    logger.info('FileUpload', `File loaded: ${slot}`, { fileName: file.name, size: file.size });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('FileUpload', `Failed to load file ${slot}`, { error: errorMsg });
    statusMessage.value = `Failed to load ${slot}: ${errorMsg}`;
    setTimeout(() => { statusMessage.value = ''; }, 5000);

    // Clear file on error
    if (isSlotA) {
      fileA.value = null;
    } else {
      fileB.value = null;
    }
  } finally {
    if (isSlotA) {
      loadingA.value = false;
    } else {
      loadingB.value = false;
    }
  }
}

function clearFile(slot: 'A' | 'B'): void {
  destroyWaveform(slot);
  if (slot === 'A') {
    fileA.value = null;
    if (inputA.value) inputA.value.value = '';
  } else {
    fileB.value = null;
    if (inputB.value) inputB.value.value = '';
  }
  store.clearFile(slot);
  logger.info('FileUpload', `File cleared: ${slot}`);
}

function destroyWaveform(slot: 'A' | 'B'): void {
  if (!waveInstances[slot]) return;
  try {
    waveInstances[slot].destroy();
  } catch (error) {
    logger.debug('FileUpload', `Destroy ${slot} failed`, { error: String(error) });
  }
  waveInstances[slot] = null;
}

async function initWaveform(slot: 'A' | 'B'): Promise<void> {
  await nextTick();

  const container = slot === 'A' ? containerA.value : containerB.value;
  if (!container) return;

  destroyWaveform(slot);

  const audioData = store.audioBuffers[slot];
  if (audioData.length === 0) return;

  try {
    const WaveSurfer = (await import('wavesurfer.js')).default;
    const sampleRate = store.sampleRates[slot];

    waveInstances[slot] = WaveSurfer.create({
      container,
      waveColor: '#2C2C2C',
      ...waveColors[slot],
      height: 80,
      normalize: true,
      peaks: [audioData],
      duration: audioData.length / sampleRate,
    });

    logger.info('FileUpload', `Waveform ${slot} initialized`, {
      samples: audioData.length,
      sampleRate,
    });
  } catch (error) {
    logger.error('FileUpload', `Failed to init waveform ${slot}`, { error: String(error) });
  }
}

function formatDuration(slot: 'A' | 'B'): string {
  const audioData = store.audioBuffers[slot];
  if (audioData.length === 0) return '0.00s';
  const sampleRate = store.sampleRates[slot];
  const durationSec = audioData.length / sampleRate;
  return `${durationSec.toFixed(2)}s`;
}

function emitRecord(slot: 'A' | 'B'): void {
  emit('record', { slot });
}
</script>

<style scoped>
.file-upload {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.section {
  margin-bottom: 12px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.section-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.upload-area {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  padding: 12px;
  text-align: center;
  transition: all 150ms;
  cursor: pointer;
  min-height: 80px;
  display: flex;
  flex-direction: column;
}

.upload-area:hover:not(.loaded) {
  border-color: var(--color-accent);
  background-color: rgba(37, 99, 235, 0.02);
}

.upload-area.active {
  border-color: var(--color-accent);
  background-color: rgba(37, 99, 235, 0.05);
}

.upload-area.loaded {
  border-color: var(--color-accent);
  background-color: rgba(37, 99, 235, 0.03);
  cursor: default;
  padding: 8px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
}

.buttons-row {
  display: flex;
  gap: 8px;
  width: 100%;
  justify-content: center;
}

.action-button {
  background-color: var(--color-accent);
  color: white;
  border: none;
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms;
  flex: 1;
  max-width: 150px;
}

.action-button:hover {
  filter: brightness(1.1);
}

.action-button.record {
  background-color: #FF3B30;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 0;
  flex: 1;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(37, 99, 235, 0.2);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 600ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  margin: 0;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.loaded-state {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.waveform-container {
  flex: 1;
  min-height: 100px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: rgba(37, 99, 235, 0.02);
  overflow: hidden;
}

.waveform-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 6px;
  border-top: 1px solid var(--color-border);
}

.duration {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-text-secondary);
}

.cancel-btn {
  background-color: transparent;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  cursor: pointer;
  transition: all 150ms;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
}

.cancel-btn:hover {
  border-color: #FF3B30;
  color: #FF3B30;
  background-color: rgba(255, 59, 48, 0.05);
}

.divider {
  height: 1px;
  background-color: var(--color-border);
  margin: 12px 0;
}

.status-message {
  padding: 8px;
  border-radius: var(--radius-sm);
  background-color: rgba(255, 59, 48, 0.1);
  border: 1px solid #FF3B30;
  color: #FF3B30;
  font-size: 11px;
  font-weight: 500;
  text-align: center;
  animation: slideIn 200ms ease-out;
}

:deep(.wavesurfer) {
  border-radius: var(--radius-sm);
}
</style>
