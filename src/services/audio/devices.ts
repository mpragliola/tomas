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

/**
 * How many channels a device delivers. Nothing in enumerateDevices() says, and
 * getSettings().channelCount is not filled in by every browser, so the input has to be
 * opened and asked — briefly, then closed. Returns 1 when the device cannot be opened,
 * which is also the only sane default for a picker.
 */
export async function probeChannelCount(deviceId?: string): Promise<number> {
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    context = new AudioContext();
    const channels = context.createMediaStreamSource(stream).channelCount;

    logger.info('devices', 'Probed input channels', { deviceId: deviceId || 'default', channels });
    return Math.max(1, channels);
  } catch (error) {
    logger.warn('devices', 'Channel probe failed, assuming mono', { error: String(error) });
    return 1;
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    await context?.close();
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
