import { describe, it, expect } from 'vitest';
import { deriveToneMatchIR } from '../../../src/services/dsp/irDerivation';
import { computeAveragedFFT } from '../../../src/services/audio/fftProcessor';
import { extractSpectrum } from '../../../src/services/dsp/spectrum';
import { convolveAudio } from '../../../src/services/audio/convolution';
import type { FFTConfig } from '../../../src/types/spectrum';

const SAMPLE_RATE = 48000;
const FFT_CONFIG: FFTConfig = { fftSize: 2048, window: 'hann', overlap: 0.5 };

/** Deterministic pseudo-random noise so the assertions are stable. */
function noise(length: number): Float32Array {
  const out = new Float32Array(length);
  let seed = 12345;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (seed / 0x3fffffff) - 1;
  }
  return out;
}

/** One-pole low-pass — produces a dark source. */
function lowPass(signal: Float32Array, coefficient: number): Float32Array {
  const out = new Float32Array(signal.length);
  let state = 0;
  for (let i = 0; i < signal.length; i++) {
    state += coefficient * (signal[i] - state);
    out[i] = state;
  }
  return out;
}

/** One-pole high-pass — produces a bright source. */
function highPass(signal: Float32Array, coefficient: number): Float32Array {
  const out = new Float32Array(signal.length);
  let state = 0;
  for (let i = 0; i < signal.length; i++) {
    state += coefficient * (signal[i] - state);
    out[i] = signal[i] - state;
  }
  return out;
}

function spectrumOf(signal: Float32Array) {
  return extractSpectrum(computeAveragedFFT(signal, FFT_CONFIG, SAMPLE_RATE));
}

/** Mean absolute dB difference between two spectra over a musical band. */
function meanAbsDbError(
  a: ReturnType<typeof spectrumOf>,
  b: ReturnType<typeof spectrumOf>,
  lowHz: number,
  highHz: number,
): number {
  // Compare shapes, not absolute level: remove each spectrum's mean over the band first.
  const bins: number[] = [];
  for (let i = 0; i < a.frequencies.length; i++) {
    if (a.frequencies[i] >= lowHz && a.frequencies[i] <= highHz) bins.push(i);
  }

  const meanOf = (s: ReturnType<typeof spectrumOf>) =>
    bins.reduce((sum, i) => sum + s.magnitudesDb[i], 0) / bins.length;

  const meanA = meanOf(a);
  const meanB = meanOf(b);

  let error = 0;
  for (const i of bins) {
    error += Math.abs((a.magnitudesDb[i] - meanA) - (b.magnitudesDb[i] - meanB));
  }
  return error / bins.length;
}

describe('irDerivation', () => {
  describe('deriveToneMatchIR', () => {
    const source = noise(SAMPLE_RATE * 2);
    const working = lowPass(source, 0.05); // A: dark
    const reference = highPass(source, 0.05); // B: bright

    const spectrumA = spectrumOf(working);
    const spectrumB = spectrumOf(reference);

    it('produces an IR of exactly the requested tap count', () => {
      for (const taps of [512, 1024, 2048, 4096]) {
        const ir = deriveToneMatchIR(spectrumA, spectrumB, SAMPLE_RATE, { taps });
        expect(ir.length).toBe(taps);
        expect(ir.coefficients.length).toBe(taps);
        expect(ir.sampleRate).toBe(SAMPLE_RATE);
      }
    });

    it('produces finite, normalised coefficients', () => {
      const ir = deriveToneMatchIR(spectrumA, spectrumB, SAMPLE_RATE, { taps: 2048 });
      let peak = 0;
      for (const value of ir.coefficients) {
        expect(Number.isFinite(value)).toBe(true);
        peak = Math.max(peak, Math.abs(value));
      }
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThanOrEqual(1);
    });

    it('is minimum phase: energy is concentrated at the start', () => {
      const ir = deriveToneMatchIR(spectrumA, spectrumB, SAMPLE_RATE, { taps: 2048 });
      const energyIn = (from: number, to: number) => {
        let sum = 0;
        for (let i = from; i < to; i++) sum += ir.coefficients[i] ** 2;
        return sum;
      };
      const head = energyIn(0, 64);
      const total = energyIn(0, ir.coefficients.length);
      expect(head / total).toBeGreaterThan(0.5);
    });

    it('makes A take on the tone of B when convolved', () => {
      const ir = deriveToneMatchIR(spectrumA, spectrumB, SAMPLE_RATE, {
        taps: 2048,
        maxBoostDb: 36,
      });

      const matched = convolveAudio({
        irCoefficients: ir.coefficients,
        audioData: working,
        sampleRate: SAMPLE_RATE,
      });

      const spectrumMatched = spectrumOf(matched);

      const errorBefore = meanAbsDbError(spectrumA, spectrumB, 100, 8000);
      const errorAfter = meanAbsDbError(spectrumMatched, spectrumB, 100, 8000);

      // The whole point: after convolution the tone should be much closer to B.
      expect(errorAfter).toBeLessThan(errorBefore / 2);
      expect(errorAfter).toBeLessThan(3);
    });
  });
});
