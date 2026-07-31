<template>
  <div class="file-upload">
    <AudioSlot
      class="audio-column"
      title="Wave 1 (A — your sound)"
      tooltip-text="Your source audio — the sound you want to reshape. Load a file or record live."
      @file-loaded="emit('file-loaded', { target: 'A', file: $event })"
      @record="emit('record', 'A')"
      @stop-record="emit('stop-record')"
    />

    <ReferenceSlot
      class="audio-column"
      title="Wave 2 (Reference)"
      tooltip-text="Your reference audio — the target tone(s) you want Wave 1 to sound like. Load, drop or clone up to 8 references."
      @file-loaded="emit('file-loaded', { target: 'reference', file: $event })"
      @record="emit('record', $event)"
      @stop-record="emit('stop-record')"
    />
  </div>
</template>

<script setup lang="ts">
import AudioSlot from './upload/AudioSlot.vue';
import ReferenceSlot from './upload/ReferenceSlot.vue';
import type { RecordTarget } from '../types/audio';

const emit = defineEmits<{
  'file-loaded': [{ target: 'A' | 'reference'; file: File }];
  record: [target: RecordTarget];
  'stop-record': [];
}>();
</script>

<style lang="scss" scoped>
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
</style>
