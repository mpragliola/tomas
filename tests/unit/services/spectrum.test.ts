import { describe, it, expect, beforeAll } from 'vitest';
import { extractSpectrum } from '../../../src/services/dsp/spectrum';
import { computeAveragedFFT, computeFFT } from '../../../src/services/audio/fftProcessor';
import type { FFTConfig } from '../../../src/types/spectrum';
import { loadSamples } from '../../fixtures';

const RATE = 48000;
const CONFIG: FFTConfig = { fftSize: 8192, window: 'hann', overlap: 0.75 };

describe('spectrum', () => {
  let sine1k: Float32Array;
  let silence: Float32Array;
  let mixed: Float32Array;

  beforeAll(async () => {
    [sine1k, silence, mixed] = await Promise.all([
      loadSamples('sine-1k'),
      loadSamples('silence'),
      loadSamples('mixed-program'),
    ]);
  });

  it('converts linear magnitude to dB bin for bin', () => {
    const spectrum = extractSpectrum(computeFFT(sine1k, CONFIG, RATE));

    expect(spectrum.magnitudesDb.length).toBe(spectrum.magnitudesLinear.length);
    for (let i = 0; i < spectrum.magnitudesDb.length; i += 61) {
      const expected = 20 * Math.log10(Math.max(spectrum.magnitudesLinear[i], 1e-10));
      expect(spectrum.magnitudesDb[i]).toBeCloseTo(expected, 4);
    }

    // The 1 kHz peak sits at 20*log10(0.25) ≈ -12 dB, a few tenths down from scalloping.
    const peakDb = Math.max(...spectrum.magnitudesDb);
    expect(peakDb).toBeGreaterThan(-14);
    expect(peakDb).toBeLessThan(-11);
  });

  it('shifts everything by the reference level, without changing the shape', () => {
    const fft = computeFFT(sine1k, CONFIG, RATE);
    const unity = extractSpectrum(fft);
    const halfScale = extractSpectrum(fft, 0.5); // ref 0.5 => +6.02 dB everywhere

    for (let i = 0; i < unity.magnitudesDb.length; i += 61) {
      expect(halfScale.magnitudesDb[i] - unity.magnitudesDb[i]).toBeCloseTo(6.0206, 3);
    }
  });

  it('clamps zero magnitude instead of returning -Infinity', () => {
    const spectrum = extractSpectrum(computeFFT(silence, CONFIG, RATE));

    for (const value of spectrum.magnitudesLinear) expect(value).toBe(0);
    for (const value of spectrum.magnitudesDb) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeCloseTo(-200, 6); // 20*log10(1e-10)
    }
  });

  it('carries the frequency grid, phases and noise floor through untouched', () => {
    const fft = computeAveragedFFT(mixed, CONFIG, RATE);
    const spectrum = extractSpectrum(fft);

    expect(spectrum.frequencies).toBe(fft.frequencies);
    expect(spectrum.phase).toBe(fft.phases);
    expect(spectrum.noiseFloorLinear).toBe(fft.noiseFloor);
    expect(spectrum.noiseFloorLinear).toBeDefined();

    // mixed-program is note-shaped over a quiet bed, so its floor must sit well below the
    // measured level in the band the notes occupy — that gap is what the SNR gate uses.
    let signal = 0;
    let floor = 0;
    let count = 0;
    for (let i = 0; i < spectrum.frequencies.length; i++) {
      if (spectrum.frequencies[i] < 200 || spectrum.frequencies[i] > 2000) continue;
      signal += 20 * Math.log10(spectrum.magnitudesLinear[i] + 1e-30);
      floor += 20 * Math.log10(spectrum.noiseFloorLinear![i] + 1e-30);
      count++;
    }
    expect(signal / count - floor / count).toBeGreaterThan(8);
  });
});
