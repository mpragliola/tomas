<template>
  <div class="section">
    <div class="section-header">
      <label class="section-title">{{ title }}</label>
      <TooltipIcon :text="tooltipText" />
    </div>

    <!-- Head shrinks and ellipsizes, tail never does — so the extension stays readable -->
    <div v-if="sourceName" class="source-name" :title="sourceName">
      <span class="source-name-head">{{ nameHead }}</span><span class="source-name-tail">{{ nameTail }}</span>
    </div>

    <div
      class="upload-area"
      :class="{ active: dragActive, loaded: hasAudio }"
      @dragover.prevent="dragActive = true"
      @dragenter.prevent="dragActive = true"
      @dragleave="dragActive = false"
      @drop.prevent="handleDrop"
    >
      <input
        ref="input"
        type="file"
        :accept="acceptAttr"
        @change="handleFileSelect"
        style="display: none"
      />

      <WaveformEditor
        target="A"
        :active="showWaveform"
        @clear="clearSlot"
        @status="setStatus"
      />

      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <p class="loading-text">Loading...</p>
      </div>

      <div v-else-if="isRecordingHere" class="empty-state">
        <div class="buttons-row">
          <button type="button" class="action-button stop" @click="emit('stop-record')">
            <Icon name="square" size="16" />
            Stop
          </button>
        </div>
        <p class="recording-hint">Recording…</p>
      </div>

      <div v-else-if="!hasAudio" class="empty-state">
        <div class="buttons-row">
          <button type="button" class="action-button" @click="input?.click()">
            <Icon name="download" size="16" />
            Load File
          </button>
          <button
            type="button"
            class="action-button record"
            :disabled="recordingElsewhere"
            :title="recordingElsewhere ? 'Another slot is recording' : 'Record into this slot'"
            @click="emit('record')"
          >
            <Icon name="mic" size="16" />
            Record
          </button>
        </div>
      </div>
    </div>

    <div v-if="message" class="status-message">
      {{ message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from '../Icon.vue';
import TooltipIcon from '../TooltipIcon.vue';
import WaveformEditor from './WaveformEditor.vue';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useAudioFileLoader } from '../../composables/useAudioFileLoader';
import { useStatusMessage } from '../../composables/useStatusMessage';

const props = defineProps<{
  title: string;
  tooltipText: string;
}>();

const emit = defineEmits<{
  'file-loaded': [file: File];
  record: [];
  'stop-record': [];
}>();

const store = useAnalysisStore();
const input = ref<HTMLInputElement>();
const { message, show, clear: clearStatus } = useStatusMessage();

// An empty message means "whatever was showing no longer applies", not "show nothing
// for 3 seconds" — the latter would leave a stale banner up on its own timer
function setStatus(text: string, durationMs?: number): void {
  if (text) show(text, durationMs);
  else clearStatus();
}

const { acceptAttr, loading, dragActive, handleFileSelect, handleDrop, clear } = useAudioFileLoader({
  onLoaded: (file) => emit('file-loaded', file),
  onError: show,
});

// Driven by the store, not by the picked File — so recordings show a waveform too
const hasAudio = computed(() => store.audioBufferA.length > 0);

const sourceName = computed(() => (hasAudio.value ? store.sourceNameA : ''));

/** Trailing run kept out of the ellipsis — long enough for the extension and a little of the stem. */
const TAIL_CHARS = 8;
const nameHead = computed(() =>
  sourceName.value.length > TAIL_CHARS + 4 ? sourceName.value.slice(0, -TAIL_CHARS) : sourceName.value,
);
const nameTail = computed(() =>
  sourceName.value.length > TAIL_CHARS + 4 ? sourceName.value.slice(-TAIL_CHARS) : '',
);

// Stop lives here, in place of Record — the recording panel is below the fold in the sidebar
const isRecordingHere = computed(() => store.recordingTarget === 'A');
const recordingElsewhere = computed(() => store.recordingTarget !== null && !isRecordingHere.value);

// The waveform block must be visible before WaveSurfer measures the container,
// otherwise it renders a zero-width canvas
const showWaveform = computed(() => hasAudio.value && !loading.value);

function clearSlot(): void {
  clear();
  if (input.value) input.value.value = '';
}
</script>

<style lang="scss" scoped>
@use '../../styles/variables' as *;
@use '../../styles/mixins' as *;

$spinner-size: 20px;

.section {
  margin-bottom: 12px;

  &-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  &-title {
    @include caps-label;
  }
}

/* Middle elision: only the head shrinks so the file extension stays readable */
.source-name {
  display: flex;
  min-width: 0;
  margin: -4px 0 8px;
  font-size: var(--font-size-label);
  color: var(--color-accent);
  white-space: nowrap;
}

.source-name-head {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-name-tail { flex: 0 0 auto; }

.upload-area {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  padding: 12px;
  text-align: center;
  transition: all $transition-fast;
  cursor: pointer;
  min-height: 80px;
  display: flex;
  flex-direction: column;

  &:hover:not(.loaded) {
    border-color: var(--color-accent);
    background-color: color-mix(in srgb, var(--color-accent) 2%, transparent);
  }

  &.active {
    border-color: var(--color-accent);
    background-color: color-mix(in srgb, var(--color-accent) 5%, transparent);
  }

  &.loaded {
    border-color: var(--color-accent);
    background-color: color-mix(in srgb, var(--color-accent) 3%, transparent);
    cursor: default;
    padding: 8px;
  }
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
  color: var(--color-accent-text);
  border: none;
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all $transition-fast;
  flex: 1;
  max-width: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  &:hover { filter: brightness(1.1); }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    filter: none;
  }

  &.record { background-color: var(--color-error); }

  &.stop {
    background-color: var(--color-error);
    animation: pulse-record 1s infinite;
  }
}

@keyframes pulse-record {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.65; }
}

.recording-hint {
  margin: 0;
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
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

.loading-text {
  margin: 0;
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
}

.status-message {
  margin-top: 8px;
  padding: 8px;
  border-radius: var(--radius-sm);
  background-color: color-mix(in srgb, var(--color-error) 10%, transparent);
  border: 1px solid var(--color-error);
  color: var(--color-error);
  font-size: var(--font-size-label);
  font-weight: 500;
  text-align: center;
  animation: slideIn 200ms ease-out;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
</style>
