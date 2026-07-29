import { ref, watch, onMounted, onUnmounted } from 'vue';
import {
  enumerateAudioDevices,
  probeChannelCount,
  requestPermission,
  type AudioDevice,
} from '../services/audio/devices';

export function useAudioDevices(isRecording: { value: boolean }) {
  const devices = ref<AudioDevice[]>([]);
  const selectedDeviceId = ref('');
  const channelCount = ref(1);
  const channelIndex = ref(0);

  async function refreshChannels(): Promise<void> {
    channelCount.value = await probeChannelCount(selectedDeviceId.value || undefined);
    if (channelIndex.value > channelCount.value - 1) channelIndex.value = 0;
  }

  async function refreshDevices(): Promise<void> {
    devices.value = await enumerateAudioDevices();
    // Labels stay blank until permission is granted once; ask so the dropdown is useful upfront
    if (devices.value.length > 0 && devices.value.every((d) => !d.label || d.label.startsWith('Microphone '))) {
      const granted = await requestPermission();
      if (granted) {
        devices.value = await enumerateAudioDevices();
      }
    }
  }

  // Channel counts are per-device and only knowable by opening the input, so the picker is
  // rebuilt on every device change. A pick beyond the new device's width falls back to the
  // first channel rather than silently recording something else.
  watch(selectedDeviceId, () => {
    if (isRecording.value) return;
    void refreshChannels();
  });

  onMounted(async () => {
    await refreshDevices();
    await refreshChannels();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
  });

  onUnmounted(() => {
    navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
  });

  return { devices, selectedDeviceId, channelCount, channelIndex, refreshDevices, refreshChannels };
}
