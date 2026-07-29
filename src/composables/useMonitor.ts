import { ref, onUnmounted } from 'vue';
import type { Ref } from 'vue';
import { logger } from '../services/logging';

export function useMonitor(selectedDeviceId: Ref<string>, channelIndex: Ref<number>) {
  const isMonitoring = ref(false);
  const currentLevelDb = ref(-60);

  let monitorContext: AudioContext | null = null;
  let monitorStream: MediaStream | null = null;
  let monitorAnalyser: AnalyserNode | null = null;
  let monitorIntervalId: number | null = null;

  async function startMonitor(): Promise<void> {
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          ...(selectedDeviceId.value ? { deviceId: { exact: selectedDeviceId.value } } : {}),
          ...(channelIndex.value > 0 ? { channelCount: { ideal: channelIndex.value + 1 } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          voiceIsolation: { ideal: false },
        } as MediaTrackConstraints,
      };
      monitorStream = await navigator.mediaDevices.getUserMedia(constraints);
      monitorContext = new AudioContext();
      const source = monitorContext.createMediaStreamSource(monitorStream);
      monitorAnalyser = monitorContext.createAnalyser();
      monitorAnalyser.fftSize = 2048;

      const inputChannels = source.channelCount;
      const ch = Math.min(Math.max(0, channelIndex.value), inputChannels - 1);
      if (inputChannels > 1) {
        const splitter = monitorContext.createChannelSplitter(inputChannels);
        source.connect(splitter);
        splitter.connect(monitorAnalyser, ch);
      } else {
        source.connect(monitorAnalyser);
      }

      // Terminate into muted gain so ScriptProcessor fires without loopback
      const sink = monitorContext.createGain();
      sink.gain.value = 0;
      monitorAnalyser.connect(sink);
      sink.connect(monitorContext.destination);

      const buf = new Float32Array(monitorAnalyser.fftSize);
      isMonitoring.value = true;
      monitorIntervalId = window.setInterval(() => {
        monitorAnalyser!.getFloatTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const abs = Math.abs(buf[i]);
          if (abs > peak) peak = abs;
        }
        currentLevelDb.value = 20 * Math.log10(Math.max(peak, 1e-10));
      }, 50);
    } catch (error) {
      logger.error('useMonitor', 'Failed to start monitor', { error: String(error) });
    }
  }

  function stopMonitor(): void {
    isMonitoring.value = false;
    if (monitorIntervalId !== null) {
      clearInterval(monitorIntervalId);
      monitorIntervalId = null;
    }
    if (monitorAnalyser) {
      monitorAnalyser.disconnect();
      monitorAnalyser = null;
    }
    if (monitorStream) {
      monitorStream.getTracks().forEach((t) => t.stop());
      monitorStream = null;
    }
    if (monitorContext) {
      void monitorContext.close();
      monitorContext = null;
    }
    currentLevelDb.value = -60;
  }

  async function toggleMonitor(): Promise<void> {
    if (isMonitoring.value) {
      stopMonitor();
    } else {
      await startMonitor();
    }
  }

  onUnmounted(() => {
    if (isMonitoring.value) stopMonitor();
  });

  return { isMonitoring, currentLevelDb, startMonitor, stopMonitor, toggleMonitor };
}
