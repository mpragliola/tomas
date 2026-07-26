import FFT from 'fft.js';
import type { FFTConfig, FFTResult } from '../../types/spectrum';
import { logger } from '../logging';
import { hannWindow, hammingWindow } from './audioUtils';

export function computeFFT(signal: Float32Array, config: FFTConfig): FFTResult {
  logger.debug('fftProcessor', 'Computing FFT', {
    fftSize: config.fftSize,
    signalLength: signal.length,
    window: config.window,
  });

  const fft = new FFT(config.fftSize);
  const windowed = applyWindow(signal, config.fftSize, config.window);

  // Pad with zeros if signal shorter than FFT size
  const input = new Array(config.fftSize * 2);
  for (let i = 0; i < config.fftSize; i++) {
    input[i * 2] = windowed[i] || 0;
    input[i * 2 + 1] = 0;
  }

  const spectrum = fft.forward(input);

  // Extract magnitude and phase
  const magnitudes = new Float32Array(config.fftSize / 2);
  const phases = new Float32Array(config.fftSize / 2);
  const nyquist = config.fftSize / (2 * signal.length);

  for (let i = 0; i < config.fftSize / 2; i++) {
    const real = spectrum[i * 2];
    const imag = spectrum[i * 2 + 1];
    magnitudes[i] = Math.sqrt(real * real + imag * imag) / (config.fftSize / 2);
    phases[i] = Math.atan2(imag, real);
  }

  // Generate frequency array
  const frequencies = new Float32Array(config.fftSize / 2);
  const sampleRate = signal.length / (config.fftSize * nyquist); // Derived from signal
  for (let i = 0; i < config.fftSize / 2; i++) {
    frequencies[i] = (i * sampleRate) / config.fftSize;
  }

  logger.debug('fftProcessor', 'FFT computed', {
    bins: config.fftSize / 2,
    maxMagnitude: Math.max(...magnitudes),
  });

  return { magnitudes, phases, frequencies };
}

function applyWindow(
  signal: Float32Array,
  fftSize: number,
  windowType: 'hann' | 'hamming' | 'rectangular',
): Float32Array {
  const windowed = new Float32Array(fftSize);
  const windowSize = Math.min(signal.length, fftSize);

  let window: Float32Array;
  if (windowType === 'hann') {
    window = hannWindow(windowSize);
  } else if (windowType === 'hamming') {
    window = hammingWindow(windowSize);
  } else {
    // rectangular
    window = new Float32Array(windowSize).fill(1);
  }

  for (let i = 0; i < windowSize; i++) {
    windowed[i] = (signal[i] || 0) * window[i];
  }

  return windowed;
}
