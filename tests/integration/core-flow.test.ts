import { describe, it, expect, beforeAll } from 'vitest';
import { computeFFT, computeAveragedFFT } from '../../src/services/audio/fftProcessor';
import { extractSpectrum } from '../../src/services/dsp/spectrum';
import { deriveToneMatchIR } from '../../src/services/dsp/irDerivation';
import { convolveAudio } from '../../src/services/audio/convolution';
import { DEFAULT_FFT_CONFIG, DEFAULT_TONE_MATCH_CONFIG } from '../../src/services/dsp/defaults';
import type { FFTConfig } from '../../src/types/spectrum';
import { loadSamples } from '../fixtures';

/**
 * The core flow on flat broadband material: `white-noise.wav` is the working take and
 * `white-noise-eq.wav` is the same noise through `targetCurveDb`, so the IR has an exact
 * job to do and the convolved result has an exact target to land on.
 */

const SAMPLE_RATE = 48000;

describe('Audio Processing Pipeline', () => {
  let audioA: Float32Array;
  let audioB: Float32Array;
  let toneA: Float32Array;

  beforeAll(async () => {
    [audioA, audioB, toneA] = await Promise.all([
      loadSamples('white-noise'),
      loadSamples('white-noise-eq'),
      loadSamples('sine-1k'),
    ]);
  });

  it('computes an FFT with the expected bin layout', () => {
    const config: FFTConfig = { fftSize: 2048, window: 'hann', overlap: 0.5 };
    const fft = computeFFT(toneA.slice(0, 2048), config, SAMPLE_RATE);

    expect(fft.magnitudes.length).toBe(1024);
    expect(fft.frequencies.length).toBe(1024);

    // A 0.5-amplitude sine should land near 0.25 in the peak bin (half the amplitude goes
    // to the negative-frequency image, and Hann's coherent gain of 0.5 doubles what the
    // normalisation divides out), i.e. the normalisation is amplitude-correct.
    const peakBin = fft.magnitudes.indexOf(Math.max(...fft.magnitudes));
    const binWidth = SAMPLE_RATE / 2048;
    expect(Math.abs(fft.frequencies[peakBin] - 1000)).toBeLessThanOrEqual(binWidth);
    expect(fft.magnitudes[peakBin]).toBeGreaterThan(0.2);
    expect(fft.magnitudes[peakBin]).toBeLessThan(0.3);
  });

  it('extracts spectra with dB conversion', () => {
    const config: FFTConfig = { fftSize: 2048, window: 'hann', overlap: 0.5 };
    const spectrum = extractSpectrum(computeFFT(toneA.slice(0, 2048), config, SAMPLE_RATE));

    expect(spectrum.magnitudesDb.length).toBe(1024);
    expect(Math.max(...spectrum.magnitudesDb)).toBeGreaterThan(-40);
  });

  it('derives a tone-match IR of the requested tap count', () => {
    const spectrumA = extractSpectrum(computeAveragedFFT(audioA, DEFAULT_FFT_CONFIG, SAMPLE_RATE));
    const spectrumB = extractSpectrum(computeAveragedFFT(audioB, DEFAULT_FFT_CONFIG, SAMPLE_RATE));

    const ir = deriveToneMatchIR(spectrumA, spectrumB, SAMPLE_RATE, DEFAULT_TONE_MATCH_CONFIG);

    expect(ir.coefficients.length).toBe(DEFAULT_TONE_MATCH_CONFIG.taps);
    expect(ir.sampleRate).toBe(SAMPLE_RATE);
    for (const value of ir.coefficients) expect(Number.isFinite(value)).toBe(true);
  });

  it('full pipeline: A + B -> IR -> convolved output matches B more closely than A did', () => {
    const spectrumOf = (signal: Float32Array) =>
      extractSpectrum(computeAveragedFFT(signal, DEFAULT_FFT_CONFIG, SAMPLE_RATE));

    const spectrumA = spectrumOf(audioA);
    const spectrumB = spectrumOf(audioB);

    const ir = deriveToneMatchIR(spectrumA, spectrumB, SAMPLE_RATE, DEFAULT_TONE_MATCH_CONFIG);

    const matched = convolveAudio({
      irCoefficients: ir.coefficients,
      audioData: audioA,
      sampleRate: SAMPLE_RATE,
    });

    expect(matched.length).toBe(audioA.length + ir.coefficients.length - 1);
    for (let i = 0; i < matched.length; i += 977) {
      expect(Number.isFinite(matched[i])).toBe(true);
    }

    const spectrumMatched = spectrumOf(matched);

    // Shape error over the match band, level difference removed.
    const shapeError = (
      x: ReturnType<typeof spectrumOf>,
      y: ReturnType<typeof spectrumOf>,
    ): number => {
      const bins: number[] = [];
      for (let i = 0; i < x.frequencies.length; i++) {
        if (x.frequencies[i] >= 100 && x.frequencies[i] <= 8000) bins.push(i);
      }
      const mean = (s: ReturnType<typeof spectrumOf>) =>
        bins.reduce((sum, i) => sum + s.magnitudesDb[i], 0) / bins.length;
      const meanX = mean(x);
      const meanY = mean(y);
      return (
        bins.reduce(
          (sum, i) => sum + Math.abs(x.magnitudesDb[i] - meanX - (y.magnitudesDb[i] - meanY)),
          0,
        ) / bins.length
      );
    };

    const before = shapeError(spectrumA, spectrumB);
    const after = shapeError(spectrumMatched, spectrumB);

    expect(after).toBeLessThan(before / 4);
    expect(after).toBeLessThan(1.5);
  });
});
