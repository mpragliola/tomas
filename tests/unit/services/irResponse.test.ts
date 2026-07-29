import { describe, it, expect } from 'vitest';
import { irMagnitudeResponse } from '../../../src/services/dsp/irResponse';
import type { ImpulseResponse } from '../../../src/types/ir';

const SAMPLE_RATE = 48000;

function irOf(coefficients: number[]): ImpulseResponse {
  const taps = new Float32Array(coefficients);
  return { coefficients: taps, length: taps.length, sampleRate: SAMPLE_RATE };
}

describe('irMagnitudeResponse', () => {
  it('reports a scaled delta as a flat gain', () => {
    const response = irMagnitudeResponse(irOf([0.5]), 1024);

    for (let i = 0; i < response.magnitudesDb.length; i++) {
      expect(response.magnitudesDb[i]).toBeCloseTo(-6.0206, 3);
    }
    expect(response.maxAbsDb).toBeCloseTo(6.0206, 3);
  });

  it('matches the analytic response of a two-tap filter', () => {
    const response = irMagnitudeResponse(irOf([1, -0.5]), 1024);

    for (let i = 0; i < response.magnitudesDb.length; i += 37) {
      const omega = (2 * Math.PI * response.frequencies[i]) / SAMPLE_RATE;
      const expectedDb = 10 * Math.log10(1.25 - Math.cos(omega));
      expect(response.magnitudesDb[i]).toBeCloseTo(expectedDb, 3);
    }
  });

  it('starts one bin above DC and stops below Nyquist', () => {
    const fftLen = 1024;
    const response = irMagnitudeResponse(irOf([1]), fftLen);
    const spacing = SAMPLE_RATE / fftLen;

    expect(response.frequencies.length).toBe(fftLen / 2 - 1);
    expect(response.frequencies[0]).toBeCloseTo(spacing, 6);
    expect(response.frequencies[response.frequencies.length - 1]).toBeLessThan(SAMPLE_RATE / 2);
  });

  it('grows the FFT so a long IR is never truncated', () => {
    const taps = new Float32Array(4096);
    taps[0] = 1;
    taps[4095] = 0.5;
    const response = irMagnitudeResponse(
      { coefficients: taps, length: taps.length, sampleRate: SAMPLE_RATE },
      1024,
    );

    // 4096 taps force an 8192-point FFT regardless of the requested length.
    expect(response.frequencies.length).toBe(8192 / 2 - 1);
  });
});
