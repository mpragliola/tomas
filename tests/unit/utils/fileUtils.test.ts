import { describe, it, expect } from 'vitest';
import { encodeWavPcm, encodeWavFloat32 } from '../../../src/utils/fileUtils';

/** Read the mono samples back out of an encoded WAV, as floats in [-1, 1]. */
function decodePcm(buffer: ArrayBuffer, bitDepth: 16 | 24): Float32Array {
  const view = new DataView(buffer);
  const bytesPerSample = bitDepth / 8;
  const count = view.getUint32(40, true) / bytesPerSample;
  const scale = Math.pow(2, bitDepth - 1) - 1;
  const out = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const offset = 44 + i * bytesPerSample;
    if (bitDepth === 16) {
      out[i] = view.getInt16(offset, true) / scale;
    } else {
      const value =
        (view.getInt8(offset + 2) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset);
      out[i] = value / scale;
    }
  }
  return out;
}

/**
 * A minimum-phase-shaped tail: a big first sample and a long exponential decay that passes
 * below the 16-bit LSB partway through. This is the shape that exposes undithered
 * quantization, because it is where a real IR keeps its low-frequency information.
 */
function decayingTail(length: number, tau: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = 0.25 * Math.exp(-i / tau) * Math.cos(i / 7);
  }
  return out;
}

describe('fileUtils', () => {
  describe('encodeWavPcm', () => {
    it('writes a PCM header the loaders expect', () => {
      const buffer = encodeWavPcm(new Float32Array(64), 48000, 24);
      const view = new DataView(buffer);

      expect(view.getUint16(20, true)).toBe(1); // format tag: integer PCM
      expect(view.getUint16(22, true)).toBe(1); // mono
      expect(view.getUint32(24, true)).toBe(48000);
      expect(view.getUint16(34, true)).toBe(24);
    });

    it('does not wrap a full-scale sample, even with dither applied', () => {
      const samples = new Float32Array([1, -1, 1, -1, 1, -1, 1, -1]);
      const decoded = decodePcm(encodeWavPcm(samples, 48000, 16, true), 16);

      // Wrapping shows up as a sign flip, which is the failure this clamp prevents.
      for (let i = 0; i < samples.length; i++) {
        expect(Math.sign(decoded[i])).toBe(Math.sign(samples[i]));
        expect(Math.abs(decoded[i])).toBeLessThanOrEqual(1.0001);
      }
    });

    it('preserves the sub-LSB tail that undithered rounding would zero', () => {
      // Tail decays well past the 16-bit LSB (~3.05e-5) by the end of the buffer.
      const original = decayingTail(4096, 300);
      const lsb = 1 / (Math.pow(2, 15) - 1);

      const undithered = decodePcm(encodeWavPcm(original, 48000, 16, false), 16);
      const dithered = decodePcm(encodeWavPcm(original, 48000, 16, true), 16);

      // Where the *envelope* has fallen below half an LSB — not the first sample that
      // happens to be small, which for a modulated tail is just a zero crossing. Past
      // this point undithered rounding sends every sample to exactly zero, taking the
      // filter's tail with it.
      const tailStart = Math.ceil(300 * Math.log(0.25 / (lsb / 2)));
      expect(tailStart).toBeGreaterThan(0);
      expect(tailStart).toBeLessThan(original.length - 200);

      const tail = original.subarray(tailStart);
      const nonZero = (samples: Float32Array) =>
        samples.subarray(tailStart).reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);

      expect(nonZero(undithered)).toBe(0);
      expect(nonZero(dithered)).toBeGreaterThan(tail.length * 0.1);
    });

    it('keeps the dithered error zero-mean, so the tail survives on average', () => {
      const original = decayingTail(8192, 900);
      const dithered = decodePcm(encodeWavPcm(original, 48000, 16, true), 16);

      let error = 0;
      for (let i = 0; i < original.length; i++) error += dithered[i] - original[i];
      const meanError = error / original.length;

      // Zero-mean to well under an LSB: that is what "the average still tracks the real
      // tail" means in practice, and it is the property truncation does not have.
      expect(Math.abs(meanError)).toBeLessThan(1 / Math.pow(2, 15));
    });
  });

  describe('encodeWavFloat32', () => {
    it('writes IEEE float (tag 3) and round-trips exactly', () => {
      const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 1e-9, -1e-9]);
      const buffer = encodeWavFloat32(samples, 44100);
      const view = new DataView(buffer);

      expect(view.getUint16(20, true)).toBe(3);
      expect(view.getUint16(34, true)).toBe(32);
      expect(view.getUint32(24, true)).toBe(44100);

      for (let i = 0; i < samples.length; i++) {
        expect(view.getFloat32(44 + i * 4, true)).toBe(samples[i]);
      }
    });

    it('does not clamp — an IR peak above 1 is legal and must survive', () => {
      // The first sample of a minimum-phase filter routinely exceeds 1. Clamping it here
      // would silently change the filter.
      const buffer = encodeWavFloat32(new Float32Array([1.55]), 48000);
      expect(new DataView(buffer).getFloat32(44, true)).toBeCloseTo(1.55, 6);
    });
  });
});
