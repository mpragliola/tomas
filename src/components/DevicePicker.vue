<template>
  <div class="device-picker">
    <div class="section-header">
      <label class="section-title">Recording input</label>
    </div>

    <div class="device-select">
      <label class="input-label">Input device</label>
      <select v-model="store.selectedInputDeviceId" class="device-dropdown">
        <option value="">System default</option>
        <option v-for="d in devices" :key="d.deviceId" :value="d.deviceId">{{ d.label }}</option>
      </select>
    </div>

    <div class="device-select">
      <label class="input-label">Input channel</label>
      <select v-model.number="store.selectedChannelIndex" :disabled="channelCount < 2" class="device-dropdown">
        <option v-for="n in channelCount" :key="n" :value="n - 1">
          Channel {{ n }}{{ channelCount === 2 ? (n === 1 ? ' (left)' : ' (right)') : '' }}
        </option>
      </select>
      <span class="device-hint">
        {{ channelCount < 2 ? 'Device is mono' : `${channelCount} channels available` }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { useAudioDevices } from '../composables/useAudioDevices';

const store = useAnalysisStore();
// No recording in progress ever disables this picker itself; WaveformEditor's own
// record-button reactivity handles the one-at-a-time lock — this panel stays live so a
// user can line up the next take's device/channel while a different slot is recording.
const alwaysFalse = { value: false };
const { devices, selectedDeviceId, channelCount, channelIndex } = useAudioDevices(alwaysFalse);

// useAudioDevices owns its own selectedDeviceId/channelIndex refs (used to drive its
// internal channel-count probing) — mirror them into the store's refs so WaveformEditor
// can read the current selection without importing this composable itself.
watch(selectedDeviceId, (v) => { store.selectedInputDeviceId = v; });
watch(channelIndex, (v) => { store.selectedChannelIndex = v; });
</script>

<style lang="scss" scoped>
@use '../styles/variables' as *;
@use '../styles/mixins' as *;

.device-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.section-title { @include caps-label; }

.device-select {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.device-dropdown {
  width: 100%;
  padding: 6px 8px;
  font-size: var(--font-size-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background-color: var(--color-bg);
  color: var(--color-text-primary);

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.device-hint {
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
  opacity: 0.8;
}

.input-label { @include caps-label; }
</style>
