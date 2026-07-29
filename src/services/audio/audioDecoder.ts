import type { AudioBuffer } from '../../types/audio';
import { logger } from '../logging';

/**
 * Rate every compressed file is decoded at. See the context construction below for why it
 * is pinned rather than left to the device.
 */
const DECODE_SAMPLE_RATE = 48000;

export async function decodeCompressedAudio(file: File): Promise<AudioBuffer> {
  logger.debug('audioDecoder', 'Decoding compressed audio', { fileName: file.name, size: file.size });

  const arrayBuffer = await file.arrayBuffer();
  // Explicit rate, because `decodeAudioData` always resamples to the context's rate and a
  // default context takes the device's — so the same MP3 would decode to 44.1 kHz on one
  // machine and 48 kHz on another, silently changing the rate the analysis runs at. The
  // container's native rate is not recoverable through Web Audio, so the choice is between
  // "device-dependent" and "always the same"; this picks the latter. Since the export path
  // renders the filter at its target rate (`renderToneMatchIR`), the working rate no longer
  // reaches the exported IR at all.
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: DECODE_SAMPLE_RATE,
  });

  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer);
    const channels = decoded.numberOfChannels;

    // Kept per channel for analysis; the mixdown below is for display and playback only.
    const channelData: Float32Array[] = [];
    for (let ch = 0; ch < channels; ch++) {
      channelData.push(decoded.getChannelData(ch).slice());
    }

    let audioData: Float32Array;
    if (channels > 1) {
      audioData = new Float32Array(decoded.length);
      for (const channel of channelData) {
        for (let i = 0; i < decoded.length; i++) {
          audioData[i] += channel[i] / channels;
        }
      }
    } else {
      audioData = channelData[0];
    }

    logger.info('audioDecoder', 'Compressed audio decoded', {
      fileName: file.name,
      sampleRate: decoded.sampleRate,
      channels,
      duration: decoded.duration.toFixed(2) + 's',
    });

    return {
      header: {
        sampleRate: decoded.sampleRate,
        channels: 1,
        bitDepth: 32,
        duration: decoded.duration,
      },
      audioData,
      channels: channelData,
    };
  } catch (error) {
    logger.error('audioDecoder', 'Failed to decode audio', { fileName: file.name, error: String(error) });
    throw new Error(`Could not decode "${file.name}" as audio. File may be corrupt or an unsupported format.`);
  } finally {
    await audioContext.close();
  }
}
