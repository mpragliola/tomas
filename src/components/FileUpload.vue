<template>
  <div class="file-upload">
    <AudioSlot
      class="audio-column"
      slot-id="A"
      title="Wave 1 (A — your sound)"
      tooltip-text="Your source audio — the sound you want to reshape. Load a file or record live."
      @file-loaded="emit('file-loaded', { slot: 'A', file: $event })"
      @record="emit('record', { slot: 'A' })"
      @stop-record="emit('stop-record')"
    />

    <div class="swap-col">
      <div class="divider-v"></div>
      <button
        type="button"
        class="btn-swap"
        :disabled="!canSwap"
        title="Swap Wave 1 and Wave 2"
        @click="store.swapSlots()"
      >
        <Icon name="repeat" size="16" />
      </button>
      <div class="divider-v"></div>
    </div>

    <AudioSlot
      class="audio-column"
      slot-id="B"
      title="Wave 2 (B — reference tone)"
      tooltip-text="Your reference audio — the target tone you want Wave 1 to sound like."
      @file-loaded="emit('file-loaded', { slot: 'B', file: $event })"
      @record="emit('record', { slot: 'B' })"
      @stop-record="emit('stop-record')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AudioSlot from './upload/AudioSlot.vue';
import Icon from './Icon.vue';
import { useAnalysisStore } from '../stores/analysisStore';
import type { SlotId } from '../types/audio';

const store = useAnalysisStore();

// Nothing to exchange until at least one slot holds audio, and a live take is
// writing into a slot that must not move under it
const canSwap = computed(
  () =>
    store.recordingSlot === null &&
    (store.audioBuffers.A.length > 0 || store.audioBuffers.B.length > 0),
);

const emit = defineEmits<{
  'file-loaded': [{ slot: SlotId; file: File }];
  record: [{ slot: SlotId }];
  'stop-record': [];
}>();
</script>

<style lang="scss" scoped>
@use '../styles/variables' as *;

$size-swap-btn: 28px;

.file-upload {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 12px;
}

.audio-column {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}

.swap-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 0 0 auto;
}

.divider-v {
  width: 1px;
  flex: 1;
  background-color: var(--color-border);
}

.btn-swap {
  flex: 0 0 auto;
  width: $size-swap-btn;
  height: $size-swap-btn;
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
</style>
