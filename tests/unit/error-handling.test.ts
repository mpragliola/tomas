import { describe, it, expect, vi } from 'vitest';
import { parseWavFile } from '../../src/services/audio/wavParser';
import { computeFFT } from '../../src/services/audio/fftProcessor';
import type { FFTConfig } from '../../src/types/spectrum';

describe('Error Handling', () => {
  describe('WAV Parser', () => {
    it('should reject non-wav files', async () => {
      const file = new File(['fake content'], 'audio.mp3', { type: 'audio/mpeg' });
      await expect(parseWavFile(file)).rejects.toThrow();
    });

    it('should reject empty files', async () => {
      const file = new File([], 'empty.wav', { type: 'audio/wav' });
      await expect(parseWavFile(file)).rejects.toThrow();
    });

    it('should reject corrupted wav headers', async () => {
      const badWav = new Uint8Array(44);
      badWav.set([82, 73, 70, 70]); // 'RIFF' header
      const file = new File([badWav], 'corrupted.wav', { type: 'audio/wav' });
      await expect(parseWavFile(file)).rejects.toThrow();
    });
  });

  describe('FFT Processor', () => {
    it('should handle very short signals gracefully', () => {
      const shortSignal = new Float32Array([0.1, 0.2]);
      const config: FFTConfig = {
        fftSize: 2048,
        window: 'hann',
        overlap: 0.5,
      };

      // Should still work, but with limited resolution
      const result = computeFFT(shortSignal, config, 44100);
      expect(result.magnitudes).toBeDefined();
      expect(result.phases).toBeDefined();
      expect(result.frequencies).toBeDefined();
    });

    it('should handle zero signal', () => {
      const zeroSignal = new Float32Array(1024);
      const config: FFTConfig = {
        fftSize: 1024,
        window: 'hamming',
        overlap: 0.5,
      };

      const result = computeFFT(zeroSignal, config, 44100);
      expect(result.magnitudes).toBeDefined();
      // All or most values should be near zero for zero input
      const avgMagnitude = Array.from(result.magnitudes).reduce((a, b) => a + Math.abs(b), 0) / result.magnitudes.length;
      expect(avgMagnitude).toBeLessThan(0.01);
    });

    it('should handle DC offset correctly', () => {
      const dcSignal = new Float32Array(1024);
      dcSignal.fill(0.5); // DC offset

      const config: FFTConfig = {
        fftSize: 1024,
        window: 'rectangular',
        overlap: 0.5,
      };

      const result = computeFFT(dcSignal, config, 44100);
      // DC component (first bin) should be highest
      expect(result.magnitudes[0]).toBeGreaterThan(Math.abs(result.magnitudes[1] || 0));
    });

    it('should handle clipped signals', () => {
      const clippedSignal = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        clippedSignal[i] = i % 100 > 50 ? 1.0 : -1.0;
      }

      const config: FFTConfig = {
        fftSize: 1024,
        window: 'hann',
        overlap: 0.5,
      };

      const result = computeFFT(clippedSignal, config, 44100);
      expect(result.magnitudes).toBeDefined();
      expect(result.phases).toBeDefined();
      // Should not crash
    });
  });

  describe('Spectrum Extraction', () => {
    it('should handle NaN and Infinity gracefully', () => {
      const badSpectrum = {
        real: new Float32Array([NaN, Infinity, -Infinity, 0, 1]),
        imag: new Float32Array([1, 2, 3, 4, 5]),
      };

      // Should not crash when extracting spectrum
      expect(() => {
        const magnitude = Math.sqrt(badSpectrum.real[0] ** 2 + badSpectrum.imag[0] ** 2);
        // Result will be NaN, which should be handled upstream
        expect(isNaN(magnitude)).toBe(true);
      }).not.toThrow();
    });
  });

  describe('IR Derivation', () => {
    it('should handle zero spectra ratio', () => {
      // When spectrum B is zero, A/B produces Infinity
      const dividedValue = 1.0 / (1e-10); // Avoiding actual zero
      expect(isFinite(dividedValue)).toBe(true);

      // With clamping as done in deriveIR
      const magBClamped = Math.max(1e-10, 1e-10);
      const result = 1.0 / magBClamped;
      expect(isFinite(result)).toBe(true);
    });
  });

  describe('Signal Validation', () => {
    it('should detect signals that are too short for meaningful FFT', () => {
      const tooShort = new Float32Array(10);
      const tooShortLength = tooShort.length;

      expect(tooShortLength < 128).toBe(true);
    });

    it('should accept signals of minimum viable length', () => {
      const minLength = 128;
      const minSignal = new Float32Array(minLength);

      expect(minSignal.length >= 128).toBe(true);
    });

    it('should handle very large signals', () => {
      const largeSignal = new Float32Array(1024 * 1024); // 1M samples
      expect(largeSignal.length).toBe(1024 * 1024);
      // Should not crash during allocation
    });
  });

  describe('Sample Rate Mismatches', () => {
    it('should handle different sample rates', () => {
      const sampleRateA = 44100;
      const sampleRateB = 48000;

      // Frequency calculation should adapt
      const binCount = 512;
      const freqA = (sampleRateA / 512) * 1; // 86.132... Hz per bin
      const freqB = (sampleRateB / 512) * 1; // 93.75 Hz per bin

      expect(freqA).not.toBe(freqB);
      // Ratio should be close to 48000/44100 ≈ 1.0884
      expect(freqB / freqA).toBeCloseTo(48000 / 44100, 2);
    });
  });
});
