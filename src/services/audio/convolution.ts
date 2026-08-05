import FFT from 'fft.js';
import { logger } from '../logging';

export interface PlaybackConfig {
  irCoefficients: Float32Array;
  audioData: Float32Array;
  sampleRate: number;
  /**
   * Scale the output down if it would clip. Off by default: a tone-match IR carries a
   * deliberate gain, and rescaling silently throws that away. Live playback routes
   * through a ConvolverNode with `normalize = false` for the same reason.
   */
  normalize?: boolean;
}

export function convolveAudio(config: PlaybackConfig): Float32Array {
  const { irCoefficients, audioData, normalize = false } = config;

  logger.debug('convolution', 'Convolving audio with IR', {
    audioLength: audioData.length,
    irLength: irCoefficients.length,
    normalize,
  });

  const output =
    irCoefficients.length > 64
      ? convolveOverlapAdd(audioData, irCoefficients)
      : convolveTimeDomain(audioData, irCoefficients);

  return normalize ? normalizeOutput(output) : output;
}

function convolveTimeDomain(signal: Float32Array, ir: Float32Array): Float32Array {
  const output = new Float32Array(signal.length + ir.length - 1);

  for (let i = 0; i < signal.length; i++) {
    const sample = signal[i];
    if (sample === 0) continue;
    for (let j = 0; j < ir.length; j++) {
      output[i + j] += sample * ir[j];
    }
  }

  return output;
}

/**
 * Overlap-add FFT convolution.
 *
 * The direct form is O(samples x taps): a 3-minute take through a 2048-tap IR is about
 * 16 billion multiply-adds, i.e. minutes of blocked main thread. This is O(n log n).
 */
function convolveOverlapAdd(signal: Float32Array, ir: Float32Array): Float32Array {
  const fftSize = nextPowerOfTwo(ir.length * 4);
  const blockSize = fftSize - ir.length + 1;
  const fft = new FFT(fftSize);

  // IR spectrum, computed once and reused for every block.
  const irPadded = new Float32Array(fftSize);
  irPadded.set(ir);
  const irSpectrum = fft.createComplexArray();
  fft.realTransform(irSpectrum, irPadded as unknown as number[]);
  fft.completeSpectrum(irSpectrum);

  const output = new Float32Array(signal.length + ir.length - 1);
  const block = new Float32Array(fftSize);
  const blockSpectrum = fft.createComplexArray();
  const product = fft.createComplexArray();
  const result = fft.createComplexArray();

  for (let start = 0; start < signal.length; start += blockSize) {
    const count = Math.min(blockSize, signal.length - start);
    block.fill(0);
    block.set(signal.subarray(start, start + count));

    fft.realTransform(blockSpectrum, block as unknown as number[]);
    fft.completeSpectrum(blockSpectrum);

    for (let k = 0; k < fftSize; k++) {
      const ar = blockSpectrum[k * 2];
      const ai = blockSpectrum[k * 2 + 1];
      const br = irSpectrum[k * 2];
      const bi = irSpectrum[k * 2 + 1];
      product[k * 2] = ar * br - ai * bi;
      product[k * 2 + 1] = ar * bi + ai * br;
    }

    fft.inverseTransform(result, product);

    const limit = Math.min(fftSize, output.length - start);
    for (let i = 0; i < limit; i++) {
      output[start + i] += result[i * 2];
    }
  }

  return output;
}

function normalizeOutput(output: Float32Array): Float32Array {
  let maxVal = 0;
  for (let i = 0; i < output.length; i++) {
    const magnitude = Math.abs(output[i]);
    if (magnitude > maxVal) maxVal = magnitude;
  }

  if (maxVal <= 1) return output;

  const normalized = new Float32Array(output.length);
  for (let i = 0; i < output.length; i++) {
    normalized[i] = output[i] / maxVal;
  }
  logger.debug('convolution', 'Output normalized', { maxVal });
  return normalized;
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}
