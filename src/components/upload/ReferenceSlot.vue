<template>
  <div class="section">
    <div class="section-header">
      <label class="section-title">{{ title }}</label>
      <TooltipIcon :text="tooltipText" />
    </div>

    <ReferenceTabBar
      v-if="showTabs"
      @add="onAddEmpty"
      @clone="onClone"
      @remove="onRemoveTab"
    />

    <!-- Single-reference view mirrors AudioSlot's source-name line; once tabs appear the
         tab bar above already carries the label, so this would just duplicate it. Drag-drop
         onto the still-wired drop zone below already lets a 2nd file join as a new tab, but
         nothing clickable offered the same path — this "+" is that missing button. It now
         adds an empty tab directly (matching ReferenceTabBar's "+"), not a file picker. -->
    <div v-if="soleReference && !showTabs" class="source-name-row">
      <div class="source-name" :title="soleReference.label">
        <span class="source-name-head">{{ nameHead }}</span><span class="source-name-tail">{{ nameTail }}</span>
      </div>
      <div class="source-name-actions">
        <button
          type="button"
          class="add-reference-btn"
          :disabled="atMaxReferences || soleReference.assetId === null"
          :title="
            soleReference.assetId === null
              ? 'Nothing to clone yet — load a file or record into it first'
              : atMaxReferences
                ? `Max ${store.MAX_REFERENCES} references reached`
                : 'Clone this reference (same audio, independent loop)'
          "
          @click="onClone(soleReference.id)"
        >
          <Icon name="copy" size="12" />
        </button>
        <button
          type="button"
          class="add-reference-btn"
          :disabled="atMaxReferences"
          :title="atMaxReferences ? `Max ${store.MAX_REFERENCES} references reached` : 'Add another reference'"
          @click="onAddEmpty"
        >
          <Icon name="plus" size="14" />
        </button>
      </div>
    </div>

    <div
      class="upload-area"
      :class="{ active: dragActive, loaded: hasAnyReference }"
      @dragover.prevent="dragActive = true"
      @dragenter.prevent="dragActive = true"
      @dragleave="dragActive = false"
      @drop.prevent="onDrop"
    >
      <input
        ref="input"
        type="file"
        multiple
        :accept="acceptAttr"
        @change="onFileSelect"
        style="display: none"
      />

      <WaveformEditor
        v-if="activeTarget"
        :target="activeTarget"
        :active="showWaveform"
        @clear="onClearActive"
        @status="setStatus"
      />

      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <p class="loading-text">Loading...</p>
      </div>

      <div v-else-if="isRecordingActive" class="empty-state">
        <div class="buttons-row">
          <button type="button" class="action-button stop" @click="emit('stop-record')">
            <Icon name="square" size="16" />
            Stop
          </button>
        </div>
        <p class="recording-hint">Recording…</p>
      </div>

      <!-- The active tab exists (a "+"-created placeholder, or one whose take/file was
           removed) but has no audio yet — same Load File / Record pair AudioSlot shows
           before A has anything loaded. -->
      <div v-else-if="activeIsEmpty" class="empty-state">
        <div class="buttons-row">
          <button type="button" class="action-button" @click="input?.click()">
            <Icon name="download" size="16" />
            Load File
          </button>
          <button
            type="button"
            class="action-button record"
            :disabled="recordingElsewhere"
            :title="recordingElsewhere ? 'Another slot is recording' : 'Record into this reference'"
            @click="onRecordActive"
          >
            <Icon name="mic" size="16" />
            Record
          </button>
        </div>
      </div>

      <!-- No reference tab exists at all yet. Record is offered here too (not just once a
           tab already exists) — otherwise the very first reference could only ever come
           from a file, an inconsistent gap next to every other tab being recordable. -->
      <div v-else-if="!hasAnyReference" class="empty-state">
        <div class="buttons-row">
          <button type="button" class="action-button" @click="input?.click()">
            <Icon name="download" size="16" />
            Load File
          </button>
          <button
            type="button"
            class="action-button record"
            :disabled="recordingElsewhere"
            :title="recordingElsewhere ? 'Another slot is recording' : 'Record a new reference'"
            @click="onRecordZero"
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
import ReferenceTabBar from './ReferenceTabBar.vue';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useReferenceFileLoader } from '../../composables/useReferenceFileLoader';
import { useStatusMessage } from '../../composables/useStatusMessage';
import type { WaveformTarget } from '../../composables/useWaveformSlot';

defineProps<{
  title: string;
  tooltipText: string;
}>();

const emit = defineEmits<{
  'file-loaded': [file: File];
  record: [{ referenceId: string }];
  'stop-record': [];
}>();

const store = useAnalysisStore();
const input = ref<HTMLInputElement>();
const { message, show, clear: clearStatus } = useStatusMessage();

function setStatus(text: string, durationMs?: number): void {
  if (text) show(text, durationMs);
  else clearStatus();
}

const { acceptAttr, loading, dragActive, handleFileSelect, handleDrop, loadFile, loadFileInto, clear } = useReferenceFileLoader({
  onLoaded: (_id, file) => emit('file-loaded', file),
  onError: show,
});

const hasAnyReference = computed(() => store.referenceOrder.length > 0);
const showTabs = computed(() => store.referenceOrder.length > 1);
const atMaxReferences = computed(() => store.referenceOrder.length >= store.MAX_REFERENCES);

const activeRef = computed(() => (store.activeReferenceId ? store.references[store.activeReferenceId] ?? null : null));
/** The active tab exists but has no audio yet — a "+"-created placeholder, most likely. */
const activeIsEmpty = computed(() => activeRef.value !== null && activeRef.value.assetId === null);

const isRecordingActive = computed(() => {
  const target = store.recordingTarget;
  return typeof target === 'object' && target !== null && target.referenceId === store.activeReferenceId;
});
const recordingElsewhere = computed(() => store.recordingTarget !== null && !isRecordingActive.value);

/** The lone reference before a 2nd is added — same single-slot look AudioSlot uses. */
const soleReference = computed(() => {
  if (store.referenceOrder.length !== 1) return null;
  return store.references[store.referenceOrder[0]] ?? null;
});

const TAIL_CHARS = 8;
const nameHead = computed(() => {
  const label = soleReference.value?.label ?? '';
  return label.length > TAIL_CHARS + 4 ? label.slice(0, -TAIL_CHARS) : label;
});
const nameTail = computed(() => {
  const label = soleReference.value?.label ?? '';
  return label.length > TAIL_CHARS + 4 ? label.slice(-TAIL_CHARS) : '';
});

const activeTarget = computed<WaveformTarget | null>(() =>
  store.activeReferenceId ? { referenceId: store.activeReferenceId } : null,
);

const showWaveform = computed(() => hasAnyReference.value && !loading.value && !activeIsEmpty.value);

async function onFileSelect(event: Event): Promise<void> {
  const files = (event.target as HTMLInputElement).files;
  // Filling in the active empty tab (a "+"-created placeholder) takes the file into
  // THAT tab rather than opening a new one; any further files picked alongside it
  // (the input allows multiple) still land as new tabs the normal way.
  if (activeIsEmpty.value && store.activeReferenceId && files && files.length > 0) {
    const [first, ...rest] = Array.from(files);
    await loadFileInto(store.activeReferenceId, first);
    for (const f of rest) await loadFile(f);
  } else {
    await handleFileSelect(event);
  }
  if (input.value) input.value.value = '';
}

async function onDrop(event: DragEvent): Promise<void> {
  await handleDrop(event);
}

function onClone(id: string): void {
  store.cloneReference(id);
}

function onRemoveTab(id: string): void {
  clear(id);
}

function onClearActive(): void {
  if (store.activeReferenceId) clear(store.activeReferenceId);
  if (input.value) input.value.value = '';
}

function onAddEmpty(): void {
  store.addEmptyReference();
}

function onRecordActive(): void {
  if (store.activeReferenceId) emit('record', { referenceId: store.activeReferenceId });
}

function onRecordZero(): void {
  const id = store.addEmptyReference();
  if (id) emit('record', { referenceId: id });
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

.source-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: -4px 0 8px;
}

/* Middle elision: only the head shrinks so the file extension stays readable */
.source-name {
  display: flex;
  min-width: 0;
  font-size: var(--font-size-label);
  color: var(--color-accent);
  white-space: nowrap;
}

.source-name-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.add-reference-btn {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--color-border);
  background-color: var(--color-bg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all $transition-fast;

  &:hover:not(:disabled) {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
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
