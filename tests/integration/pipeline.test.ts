import { describe, it, expect, beforeAll } from 'vitest';
import { parseWavFile } from '../../src/services/audio/wavParser';
import { computeAveragedFFT } from '../../src/services/audio/fftProcessor';
import { extractSpectrum } from '../../src/services/dsp/spectrum';
import { deriveToneMatchIR } from '../../src/services/dsp/irDerivation';
import { convolveAudio } from '../../src/services/audio/convolution';
import { DEFAULT_FFT_CONFIG, DEFAULT_TONE_MATCH_CONFIG } from '../../src/services/dsp/defaults';
import type { FrequencySpectrum } from '../../src/types/spectrum';
import { toneFile } from '../fixtures';
import { cabCurveDb } from '../fixtures/curves.mjs';

/**
 * The whole chain the app runs, starting where the app starts: a WAV file on disk.
 *
 * `cab-noise.wav` and `cab-noise-eq.wav` are the same pink noise through the same cab
 * curve; the -eq take has `targetCurveDb` on top of it. So the tone match has a known
 * right answer, and convolving the working take with the derived IR has to land on the
 * reference take's tone.
 */

const RATE = 48000;

function bandBins(spectrum: FrequencySpectrum, lowHz: number, highHz: number): number[] {
  const bins: number[] = [];
  for (let i = 0; i < spectrum.frequencies.length; i++) {
    if (spectrum.frequencies[i] >= lowHz && spectrum.frequencies[i] <= highHz) bins.push(i);
  }
  return bins;
}

function meanDb(spectrum: FrequencySpectrum, bins: number[]): number {
  return bins.reduce((sum, i) => sum + spectrum.magnitudesDb[i], 0) / bins.length;
}

/** Mean absolute dB difference between two spectra over a band, level difference removed. */
function shapeError(a: FrequencySpectrum, b: FrequencySpectrum, lowHz: number, highHz: number) {
  const bins = bandBins(a, lowHz, highHz);
  const meanA = meanDb(a, bins);
  const meanB = meanDb(b, bins);
  return (
    bins.reduce(
      (sum, i) => sum + Math.abs(a.magnitudesDb[i] - meanA - (b.magnitudesDb[i] - meanB)),
      0,
    ) / bins.length
  );
}

describe('audio pipeline integration', () => {
  let working: Float32Array;
  let spectrumWorking: FrequencySpectrum;
  let spectrumReference: FrequencySpectrum;

  const spectrumOf = (signal: Float32Array, sampleRate = RATE) =>
    extractSpectrum(computeAveragedFFT(signal, DEFAULT_FFT_CONFIG, sampleRate));

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      parseWavFile(toneFile('cab-noise')),
      parseWavFile(toneFile('cab-noise-eq')),
    ]);
    working = a.audioData;
    spectrumWorking = spectrumOf(working);
    spectrumReference = spectrumOf(b.audioData);
  });

  it('processes a WAV file into the spectrum the file was built to have', async () => {
    const parsed = await parseWavFile(toneFile('cab-noise'));
    expect(parsed.header.sampleRate).toBe(RATE);

    const spectrum = spectrumOf(parsed.audioData);
    expect(spectrum.magnitudesDb.length).toBe(DEFAULT_FFT_CONFIG.fftSize / 2);

    // Per-bin level falls 3 dB/octave from the pink noise itself, plus whatever the cab
    // curve does — and at the edges the cab is what dominates.
    const passband = meanDb(spectrum, bandBins(spectrum, 400, 2000));
    for (const [lowHz, highHz] of [
      [40, 60],
      [12000, 16000],
    ]) {
      const centre = Math.sqrt(lowHz * highHz);
      const measured = meanDb(spectrum, bandBins(spectrum, lowHz, highHz)) - passband;
      const expected = cabCurveDb(centre) - cabCurveDb(1000) - 3 * Math.log2(centre / 1000);
      expect(Math.abs(measured - expected)).toBeLessThan(6);
    }
  });

  it('derives an IR from the two spectra', () => {
    const ir = deriveToneMatchIR(
      spectrumWorking,
      spectrumReference,
      RATE,
      DEFAULT_TONE_MATCH_CONFIG,
    );

    expect(ir.coefficients.length).toBe(DEFAULT_TONE_MATCH_CONFIG.taps);
    expect(ir.sampleRate).toBe(RATE);
    for (const value of ir.coefficients) expect(Number.isFinite(value)).toBe(true);

    // Minimum phase: the energy sits at the front, which is what an IR loader expects.
    const energy = (from: number, to: number) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += ir.coefficients[i] ** 2;
      return sum;
    };
    expect(energy(0, 64) / energy(0, ir.coefficients.length)).toBeGreaterThan(0.5);
  });

  it('applies the IR: the convolved take takes on the reference tone', () => {
    const ir = deriveToneMatchIR(
      spectrumWorking,
      spectrumReference,
      RATE,
      DEFAULT_TONE_MATCH_CONFIG,
    );

    const matched = convolveAudio({
      irCoefficients: ir.coefficients,
      audioData: working,
      sampleRate: RATE,
    });

    expect(matched.length).toBe(working.length + ir.coefficients.length - 1);
    for (let i = 0; i < matched.length; i += 977) expect(Number.isFinite(matched[i])).toBe(true);

    const before = shapeError(spectrumWorking, spectrumReference, 100, 5000);
    const after = shapeError(spectrumOf(matched), spectrumReference, 100, 5000);

    expect(after).toBeLessThan(before / 4);
    expect(after).toBeLessThan(0.5);
  });
});
