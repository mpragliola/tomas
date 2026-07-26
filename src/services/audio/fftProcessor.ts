import FFT from 'fft.js';
import type { FFTConfig, FFTResult } from '../../types/spectrum';
import { logger } from '../logging';
import { hannWindow, hammingWindow } from './audioUtils';

export function computeFFT(signal: Float32Array, config: FFTConfig, sampleRate: number = 44100): FFTResult {
  logger.debug('fftProcessor', 'Computing FFT', {
    fftSize: config.fftSize,
    signalLength: signal.length,
    window: config.window,
    sampleRate,
  });

  const fft = new FFT(config.fftSize);
  const windowed = applyWindow(signal, config.fftSize, config.window);

  // realTransform expects a *real* input array — passing an interleaved complex
  // array would zero-stuff the signal and alias the spectrum.
  const spectrum = fft.createComplexArray();
  fft.realTransform(spectrum, windowed);

  // Extract magnitude and phase
  const magnitudes = new Float32Array(config.fftSize / 2);
  const phases = new Float32Array(config.fftSize / 2);

  for (let i = 0; i < config.fftSize / 2; i++) {
    const real = spectrum[i * 2];
    const imag = spectrum[i * 2 + 1];
    magnitudes[i] = Math.sqrt(real * real + imag * imag) / (config.fftSize / 2);
    phases[i] = Math.atan2(imag, real);
  }

  // Generate frequency array using actual sample rate
  const frequencies = new Float32Array(config.fftSize / 2);
  for (let i = 0; i < config.fftSize / 2; i++) {
    frequencies[i] = (i * sampleRate) / config.fftSize;
  }

  logger.debug('fftProcessor', 'FFT computed', {
    bins: config.fftSize / 2,
    maxMagnitude: Math.max(...magnitudes),
  });

  return { magnitudes, phases, frequencies };
}

/**
 * Welch-averaged magnitude spectrum across the whole signal.
 *
 * `computeFFT` only ever looks at the first `fftSize` samples, which for a multi-minute
 * recording characterises a few milliseconds of audio. Tone matching needs the average
 * behaviour of the whole take, so this averages the power spectrum over overlapping frames.
 *
 * The returned phases are zero: averaged magnitudes have no meaningful phase.
 */
export function computeAveragedFFT(
  signal: Float32Array,
  config: FFTConfig,
  sampleRate: number = 44100,
  maxFrames: number = 512,
): FFTResult {
  const { fftSize } = config;

  if (signal.length < fftSize) {
    return computeFFT(signal, config, sampleRate);
  }

  const binCount = fftSize / 2;
  const hop = Math.max(1, Math.round(fftSize * (1 - config.overlap)));
  const totalFrames = Math.floor((signal.length - fftSize) / hop) + 1;
  // Spread a bounded number of frames across the whole signal rather than analysing
  // only the first `maxFrames` of them.
  const stride = Math.max(1, Math.ceil(totalFrames / maxFrames));

  const fft = new FFT(fftSize);
  const spectrum = fft.createComplexArray();
  const window = buildWindow(fftSize, config.window);
  const frame = new Float32Array(fftSize);
  const power = new Float64Array(binCount);

  let frames = 0;
  for (let f = 0; f < totalFrames; f += stride) {
    const start = f * hop;
    for (let i = 0; i < fftSize; i++) {
      frame[i] = signal[start + i] * window[i];
    }

    fft.realTransform(spectrum, frame);

    for (let i = 0; i < binCount; i++) {
      const real = spectrum[i * 2];
      const imag = spectrum[i * 2 + 1];
      power[i] += real * real + imag * imag;
    }
    frames++;
  }

  const magnitudes = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    magnitudes[i] = Math.sqrt(power[i] / frames) / binCount;
  }

  const frequencies = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    frequencies[i] = (i * sampleRate) / fftSize;
  }

  logger.debug('fftProcessor', 'Averaged FFT computed', {
    bins: binCount,
    frames,
    totalFrames,
    sampleRate,
  });

  return { magnitudes, phases: new Float32Array(binCount), frequencies };
}

function buildWindow(
  length: number,
  windowType: 'hann' | 'hamming' | 'rectangular',
): Float32Array {
  if (windowType === 'hann') return hannWindow(length);
  if (windowType === 'hamming') return hammingWindow(length);
  return new Float32Array(length).fill(1);
}

function applyWindow(
  signal: Float32Array,
  fftSize: number,
  windowType: 'hann' | 'hamming' | 'rectangular',
): Float32Array {
  const windowed = new Float32Array(fftSize);
  const windowSize = Math.min(signal.length, fftSize);
  const window = buildWindow(windowSize, windowType);

  for (let i = 0; i < windowSize; i++) {
    windowed[i] = (signal[i] || 0) * window[i];
  }

  return windowed;
}
