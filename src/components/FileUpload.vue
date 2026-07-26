<template>
  <div class="file-upload">
    <div class="section">
      <div class="section-header">
        <label class="section-title">Wave 1 (Target)</label>
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

        <!-- Loaded state -->
        <div v-else-if="fileA" class="loaded-state">
          <p class="file-name">{{ fileA.name }}</p>
          <button type="button" class="cancel-button" @click.stop="clearFile('A')">
            ✕ Clear
          </button>
        </div>

        <!-- Empty state -->
        <div v-else class="empty-state">
          <button type="button" class="upload-button" @click="inputA?.click()">
            📁 Choose File
          </button>
          <p class="upload-hint">or drag WAV here</p>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="section">
      <div class="section-header">
        <label class="section-title">Wave 2 (Reference)</label>
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

        <!-- Loaded state -->
        <div v-else-if="fileB" class="loaded-state">
          <p class="file-name">{{ fileB.name }}</p>
          <button type="button" class="cancel-button" @click.stop="clearFile('B')">
            ✕ Clear
          </button>
        </div>

        <!-- Empty state -->
        <div v-else class="empty-state">
          <button type="button" class="upload-button" @click="inputB?.click()">
            📁 Choose File
          </button>
          <p class="upload-hint">or drag WAV here</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';

const store = useAnalysisStore();
const inputA = ref<HTMLInputElement>();
const inputB = ref<HTMLInputElement>();
const fileA = ref<File | null>(null);
const fileB = ref<File | null>(null);
const dragActiveA = ref(false);
const dragActiveB = ref(false);
const loadingA = ref(false);
const loadingB = ref(false);

const emit = defineEmits<{
  'file-loaded': [{ slot: 'A' | 'B'; file: File }];
}>();

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
  if (!file.name.endsWith('.wav')) {
    logger.warn('FileUpload', 'Invalid file type', { fileName: file.name });
    return;
  }

  if (file.size > 100 * 1024 * 1024) {
    logger.warn('FileUpload', 'File too large (max 100MB)', { size: file.size });
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
    logger.info('FileUpload', `File loaded: ${slot}`, { fileName: file.name });
  } catch (error) {
    logger.error('FileUpload', `Failed to load file ${slot}`, { error: String(error) });
  } finally {
    if (isSlotA) {
      loadingA.value = false;
    } else {
      loadingB.value = false;
    }
  }
}

function clearFile(slot: 'A' | 'B'): void {
  if (slot === 'A') {
    fileA.value = null;
    if (inputA.value) inputA.value.value = '';
  } else {
    fileB.value = null;
    if (inputB.value) inputB.value.value = '';
  }
  logger.info('FileUpload', `File cleared: ${slot}`);
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
}

.upload-button {
  background-color: var(--color-accent);
  color: white;
  border: none;
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms;
  margin-bottom: 4px;
}

.upload-button:hover {
  filter: brightness(1.1);
}

.upload-hint {
  margin: 0;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.file-name {
  margin: 4px 0 0 0;
  font-size: 11px;
  color: var(--color-accent);
  font-weight: 500;
  word-break: break-word;
  font-family: var(--font-mono);
}

.divider {
  height: 1px;
  background-color: var(--color-border);
  margin: 12px 0;
}

.value {
  color: var(--color-success);
  font-size: 12px;
  font-weight: 600;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
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
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}

.cancel-button {
  background-color: transparent;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  padding: 6px 10px;
  border-radius: var(--radius-md);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms;
}

.cancel-button:hover {
  border-color: #FF3B30;
  color: #FF3B30;
  background-color: rgba(255, 59, 48, 0.05);
}
</style>
