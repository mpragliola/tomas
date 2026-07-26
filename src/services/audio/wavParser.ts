import type { WavHeader, AudioBuffer } from '../../types/audio';
import { logger } from '../logging';

export async function parseWavFile(file: File): Promise<AudioBuffer> {
  logger.debug('wavParser', 'Parsing WAV file', { fileName: file.name, size: file.size });

  const arrayBuffer = await file.arrayBuffer();
  const view = new DataView(arrayBuffer);

  if (file.size < 44) {
    throw new Error('WAV file too small (minimum 44 bytes for header)');
  }

  // Parse RIFF header
  const riffMagic = String.fromCharCode(...new Uint8Array(arrayBuffer, 0, 4));
  if (riffMagic !== 'RIFF') {
    throw new Error('Invalid WAV file: missing RIFF header');
  }

  const fmtOffset = findChunk(view, 'fmt ');
  if (fmtOffset < 0) {
    throw new Error('Invalid WAV file: missing fmt chunk');
  }

  const dataOffset = findChunk(view, 'data');
  if (dataOffset < 0) {
    throw new Error('Invalid WAV file: missing data chunk');
  }

  // Parse fmt subchunk
  const audioFormat = view.getUint16(fmtOffset + 8, true);
  const channels = view.getUint16(fmtOffset + 10, true);
  const sampleRate = view.getUint32(fmtOffset + 12, true);
  const bitDepth = view.getUint16(fmtOffset + 22, true) as 16 | 24 | 32;

  if (audioFormat !== 1) {
    throw new Error('Only uncompressed PCM WAV files are supported');
  }

  if (![16, 24, 32].includes(bitDepth)) {
    throw new Error(`Unsupported bit depth: ${bitDepth}. Only 16, 24, 32 supported.`);
  }

  // Parse data subchunk
  const dataChunkSize = view.getUint32(dataOffset + 4, true);
  const dataStart = dataOffset + 8;
  const numSamples = dataChunkSize / (channels * bitDepth / 8);
  const duration = numSamples / sampleRate;

  const header: WavHeader = {
    sampleRate,
    channels,
    bitDepth,
    duration,
  };

  // Convert PCM to Float32Array
  const audioData = pcmToFloat32(
    view,
    dataStart,
    numSamples,
    channels,
    bitDepth,
  );

  // Mix stereo to mono if needed
  const monoAudio = channels > 1 ? stereoToMono(audioData, numSamples, channels) : audioData;

  logger.info('wavParser', 'WAV file parsed', {
    fileName: file.name,
    sampleRate,
    channels,
    bitDepth,
    duration: duration.toFixed(2) + 's',
    samples: numSamples,
  });

  return {
    header: { ...header, channels: 1 }, // Always return mono
    audioData: monoAudio,
  };
}

function findChunk(view: DataView, chunkId: string): number {
  let pos = 12; // Start after RIFF header + size
  while (pos < view.byteLength - 8) {
    const id = String.fromCharCode(
      view.getUint8(pos),
      view.getUint8(pos + 1),
      view.getUint8(pos + 2),
      view.getUint8(pos + 3),
    );
    if (id === chunkId) {
      return pos;
    }
    const chunkSize = view.getUint32(pos + 4, true);
    pos += 8 + chunkSize;
  }
  return -1;
}

function pcmToFloat32(
  view: DataView,
  offset: number,
  numSamples: number,
  channels: number,
  bitDepth: 16 | 24 | 32,
): Float32Array {
  const audioData = new Float32Array(numSamples * channels);
  let bytePos = offset;

  const bytesPerSample = bitDepth / 8;
  const max = Math.pow(2, bitDepth - 1);

  for (let i = 0; i < numSamples * channels; i++) {
    let sample: number;

    if (bitDepth === 16) {
      sample = view.getInt16(bytePos, true) / max;
    } else if (bitDepth === 24) {
      const byte1 = view.getUint8(bytePos);
      const byte2 = view.getUint8(bytePos + 1);
      const byte3 = view.getInt8(bytePos + 2);
      sample = (byte3 << 16 | byte2 << 8 | byte1) / max;
    } else {
      sample = view.getInt32(bytePos, true) / max;
    }

    audioData[i] = Math.max(-1, Math.min(1, sample));
    bytePos += bytesPerSample;
  }

  return audioData;
}

function stereoToMono(
  stereoData: Float32Array,
  numSamples: number,
  channels: number,
): Float32Array {
  const monoData = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      sum += stereoData[i * channels + ch];
    }
    monoData[i] = sum / channels;
  }

  return monoData;
}
