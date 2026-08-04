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
    </div>

    <div v-if="message" class="status-message">
      {{ message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import Icon from '../Icon.vue';
import TooltipIcon from '../TooltipIcon.vue';
import WaveformEditor from './WaveformEditor.vue';
import ReferenceTabBar from './ReferenceTabBar.vue';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useReferenceFileLoader } from '../../composables/useReferenceFileLoader';
import { useStatusMessage } from '../../composables/useStatusMessage';
import type { WaveformTarget } from '../../composables/useWaveformSlot';
import { isSupportedAudioFile } from '../../services/audio/audioLoader';

defineProps<{
  title: string;
  tooltipText: string;
}>();

const emit = defineEmits<{
  'file-loaded': [file: File];
}>();

const store = useAnalysisStore();
const { message, show, clear: clearStatus } = useStatusMessage();

function setStatus(text: string, durationMs?: number): void {
  if (text) show(text, durationMs);
  else clearStatus();
}

const { loading, dragActive, handleDrop, loadFile, loadFileInto, clear } = useReferenceFileLoader({
  onLoaded: (_id, file) => emit('file-loaded', file),
  onError: show,
});

const hasAnyReference = computed(() => store.referenceOrder.length > 0);
const showTabs = computed(() => store.referenceOrder.length > 1);
const atMaxReferences = computed(() => store.referenceOrder.length >= store.MAX_REFERENCES);

const activeRef = computed(() => (store.activeReferenceId ? store.references[store.activeReferenceId] ?? null : null));
/** The active tab exists but has no audio yet — a "+"-created placeholder, most likely. */
const activeIsEmpty = computed(() => activeRef.value !== null && activeRef.value.assetId === null);

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

const showWaveform = computed(() => !loading.value);

/**
 * Zero-reference chicken-and-egg: `WaveformEditor` needs a concrete `WaveformTarget`
 * (`activeTarget` above is null with no reference tab to point it at), and before this
 * task the only way to create a first tab was ReferenceTabBar's "+" — which itself only
 * renders once `showTabs` (2+ references) is true. Nothing could ever create the first
 * one. Seeds exactly the same empty-tab state a manual "+" click already produces,
 * whenever the count drops to zero — not just on initial mount, since the sole
 * auto-seeded (empty) tab's own "Remove file" button (WaveformEditor's cancel-btn, shown
 * even with no audio loaded) can delete it right back to zero, and nothing else would
 * ever re-seed it after that. `immediate: true` covers the initial mount case too, so a
 * separate onMounted isn't needed. Guarded the same way `addEmptyReference()` guards
 * itself (MAX_REFERENCES, logged there) — this only ever calls it from exactly zero.
 */
watch(
  () => store.referenceOrder.length,
  (count) => {
    if (count === 0) store.addEmptyReference();
  },
  { immediate: true },
);

async function onDrop(event: DragEvent): Promise<void> {
  // "Fill the active empty tab instead of opening a new one" — without this, dropping a
  // file while the auto-seeded empty tab is active (the common case now that a reference
  // slot always starts with one, per the watch above) would silently add a 2nd, inactive
  // tab instead of ever showing the dropped audio, since addReference() only activates a
  // *new* tab when no tab was active yet (see analysisStore.addReference), and one
  // already is here.
  const files = event.dataTransfer?.files;
  if (activeIsEmpty.value && store.activeReferenceId && files && files.length > 0) {
    dragActive.value = false;
    const supported = Array.from(files).filter((f) => isSupportedAudioFile(f.name));
    if (supported.length === 0) return;
    const [first, ...rest] = supported;
    await loadFileInto(store.activeReferenceId, first);
    for (const f of rest) await loadFile(f);
  } else {
    await handleDrop(event);
  }
}

function onClone(id: string): void {
  store.cloneReference(id);
}

function onRemoveTab(id: string): void {
  clear(id);
}

function onClearActive(): void {
  if (store.activeReferenceId) clear(store.activeReferenceId);
}

function onAddEmpty(): void {
  store.addEmptyReference();
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
  min-height: 28px;
  margin: 0 0 8px;
}

/* Middle elision: only the head shrinks so the file extension stays readable */
.source-name {
  display: flex;
  min-width: 0;
  font-size: var(--font-size-micro);
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
