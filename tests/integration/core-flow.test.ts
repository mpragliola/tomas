import { describe, it, expect, beforeAll } from 'vitest';
import { parseWavFile } from '../../src/services/audio/wavParser';
import { computeFFT } from '../../src/services/audio/fftProcessor';
import { extractSpectrum } from '../../src/services/dsp/spectrum';
import { deriveIR } from '../../src/services/dsp/irDerivation';
import { convolveAudio } from '../../src/services/audio/convolution';
import type { FFTConfig } from '../../src/types/spectrum';
import type { IRDerivationConfig } from '../../src/types/ir';

describe('Audio Processing Pipeline', () => {
  let audioA: Float32Array;
  let audioB: Float32Array;

  beforeAll(async () => {
    // Create test audio: sine waves at different frequencies
    const sampleRate = 44100;
    const duration = 1; // 1 second
    const numSamples = sampleRate * duration;

    // Audio A: 440 Hz sine (A4 note)
    audioA = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      audioA[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.8;
    }

    // Audio B: 880 Hz sine (A5 note, one octave higher)
    audioB = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      audioB[i] = Math.sin((2 * Math.PI * 880 * i) / sampleRate) * 0.8;
    }
  });

  it('should compute FFT and extract spectra', () => {
    const config: FFTConfig = {
      fftSize: 2048,
      window: 'hann',
      overlap: 0.5,
    };

    const fftA = computeFFT(audioA.slice(0, 2048), config);
    const fftB = computeFFT(audioB.slice(0, 2048), config);

    expect(fftA.magnitudes.length).toBe(1024);
    expect(fftB.magnitudes.length).toBe(1024);
    expect(fftA.frequencies.length).toBe(1024);

    // Audio A and B should have peaks (just verify magnitude is reasonable)
    const maxIdxA = Array.from(fftA.magnitudes).indexOf(Math.max(...fftA.magnitudes));
    const peakMagA = fftA.magnitudes[maxIdxA];
    expect(peakMagA).toBeGreaterThan(0.1); // Should have a strong peak

    const maxIdxB = Array.from(fftB.magnitudes).indexOf(Math.max(...fftB.magnitudes));
    const peakMagB = fftB.magnitudes[maxIdxB];
    expect(peakMagB).toBeGreaterThan(0.1); // Should have a strong peak
  });

  it('should extract spectra with dB conversion', () => {
    const config: FFTConfig = {
      fftSize: 2048,
      window: 'hann',
      overlap: 0.5,
    };

    const fftA = computeFFT(audioA.slice(0, 2048), config);
    const spectrumA = extractSpectrum(fftA);

    expect(spectrumA.magnitudesDb.length).toBe(1024);
    expect(spectrumA.magnitudesDb[0]).toBeLessThan(0); // dB should be negative
    expect(Math.max(...spectrumA.magnitudesDb)).toBeGreaterThan(-40); // Peak should be strong
  });

  it('should derive IR from two spectra', () => {
    const config: FFTConfig = {
      fftSize: 2048,
      window: 'hann',
      overlap: 0.5,
    };

    const fftA = computeFFT(audioA.slice(0, 2048), config);
    const fftB = computeFFT(audioB.slice(0, 2048), config);

    const spectrumA = extractSpectrum(fftA);
    const spectrumB = extractSpectrum(fftB);

    const irConfig: IRDerivationConfig = {
      method: 'difference',
      phase: 'preserve-B',
      maxLength: 44100,
      truncationDb: -60,
    };

    const ir = deriveIR(spectrumA, spectrumB, irConfig);

    expect(ir.coefficients.length).toBeGreaterThan(0);
    expect(ir.length).toBeLessThanOrEqual(44100);
    expect(ir.sampleRate).toBe(44100);
  });

  it('should convolve audio with IR', () => {
    const config: FFTConfig = {
      fftSize: 2048,
      window: 'hann',
      overlap: 0.5,
    };

    const fftA = computeFFT(audioA.slice(0, 2048), config);
    const fftB = computeFFT(audioB.slice(0, 2048), config);

    const spectrumA = extractSpectrum(fftA);
    const spectrumB = extractSpectrum(fftB);

    const irConfig: IRDerivationConfig = {
      method: 'difference',
      phase: 'preserve-B',
      maxLength: 1000,
      truncationDb: -60,
    };

    const ir = deriveIR(spectrumA, spectrumB, irConfig);

    const convolved = convolveAudio({
      irCoefficients: ir.coefficients,
      audioData: audioA,
      sampleRate: 44100,
    });

    expect(convolved.length).toBeGreaterThan(0);
    // Check that output is normalized to [-1, 1]
    const maxVal = Math.max(...Array.from(convolved).map(Math.abs));
    expect(maxVal).toBeLessThanOrEqual(1.0);
  });

  it('full pipeline: audio A + audio B -> IR -> convolved output', () => {
    const fftConfig: FFTConfig = {
      fftSize: 2048,
      window: 'hann',
      overlap: 0.5,
    };

    // Step 1: Compute spectra
    const fftA = computeFFT(audioA.slice(0, 2048), fftConfig);
    const fftB = computeFFT(audioB.slice(0, 2048), fftConfig);

    const spectrumA = extractSpectrum(fftA);
    const spectrumB = extractSpectrum(fftB);

    // Step 2: Derive IR
    const irConfig: IRDerivationConfig = {
      method: 'ratio',
      phase: 'preserve-B',
      maxLength: 1000,
      truncationDb: -60,
    };

    const ir = deriveIR(spectrumA, spectrumB, irConfig);

    // Step 3: Convolve
    const convolved = convolveAudio({
      irCoefficients: ir.coefficients,
      audioData: audioA,
      sampleRate: 44100,
    });

    // Verify output
    expect(convolved.length).toBeGreaterThan(0);
    expect(Math.max(...Array.from(convolved).map(Math.abs))).toBeLessThanOrEqual(1.0);
  });
});
