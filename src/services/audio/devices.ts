import { logger } from '../logging';

export interface AudioDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

export async function enumerateAudioDevices(): Promise<AudioDevice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${d.deviceId.slice(0, 5)}`,
        groupId: d.groupId,
      }));

    logger.info('devices', 'Enumerated audio devices', { count: audioInputs.length });
    return audioInputs;
  } catch (error) {
    logger.error('devices', 'Failed to enumerate audio devices', { error: String(error) });
    return [];
  }
}

export async function requestPermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    logger.info('devices', 'Microphone permission granted');
    return true;
  } catch (error) {
    logger.warn('devices', 'Microphone permission denied', { error: String(error) });
    return false;
  }
}
