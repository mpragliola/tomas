import { describe, it, expect } from 'vitest';
import { computeAveragedFFT } from '../../../src/services/audio/fftProcessor';
import { parseWavFile } from '../../../src/services/audio/wavParser';
import type { FFTConfig } from '../../../src/types/spectrum';
import { toneFile } from '../../fixtures';

const SAMPLE_RATE = 48000;
const FFT_CONFIG: FFTConfig = { fftSize: 2048, window: 'hann', overlap: 0.5 };
const LENGTH = 48000;

/** Deterministic white noise — the tests compare spectra, so the seed must not drift. */
function noise(seed: number, length = LENGTH): Float32Array {
  let state = seed >>> 0;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (state / 0xffffffff) * 2 - 1;
  }
  return out;
}

function inverted(signal: Float32Array): Float32Array {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = -signal[i];
  return out;
}

function delayed(signal: Float32Array, samples: number): Float32Array {
  const out = new Float32Array(signal.length);
  out.set(signal.subarray(0, signal.length - samples), samples);
  return out;
}

function monoMix(...channels: Float32Array[]): Float32Array {
  const out = new Float32Array(channels[0].length);
  for (const channel of channels) {
    for (let i = 0; i < out.length; i++) out[i] += channel[i] / channels.length;
  }
  return out;
}

function magnitudesOf(input: Float32Array | Float32Array[]): Float32Array {
  return computeAveragedFFT(input, FFT_CONFIG, SAMPLE_RATE).magnitudes;
}

function dbAt(magnitudes: Float32Array, hz: number): number {
  const bin = Math.round((hz * FFT_CONFIG.fftSize) / SAMPLE_RATE);
  return 20 * Math.log10(Math.max(magnitudes[bin], 1e-12));
}

/** Mean absolute dB difference over a musical band. */
function meanAbsDbDiff(a: Float32Array, b: Float32Array, lowHz: number, highHz: number): number {
  const lowBin = Math.ceil((lowHz * FFT_CONFIG.fftSize) / SAMPLE_RATE);
  const highBin = Math.floor((highHz * FFT_CONFIG.fftSize) / SAMPLE_RATE);

  let error = 0;
  for (let i = lowBin; i <= highBin; i++) {
    error += Math.abs(
      20 * Math.log10(Math.max(a[i], 1e-12)) - 20 * Math.log10(Math.max(b[i], 1e-12)),
    );
  }
  return error / (highBin - lowBin + 1);
}

describe('stereo analysis', () => {
  describe('incoherent channel sum', () => {
    /**
     * The defect this replaced: `(L+R)/2` is a coherent sum, so a phase-inverted right
     * channel cancels the take to digital silence before the FFT ever runs. The material
     * is plainly there — it is only the *summing* that destroyed it.
     */
    it('measures anti-phase channels that a mono mix would cancel to silence', () => {
      const left = noise(1);
      const right = inverted(left);

      expect(monoMix(left, right).every((v) => Math.abs(v) < 1e-9)).toBe(true);

      const stereo = magnitudesOf([left, right]);
      const reference = magnitudesOf(left);

      expect(meanAbsDbDiff(stereo, reference, 100, 16000)).toBeLessThan(0.01);
    });

    /**
     * The realistic case. Haas widening, a decorrelated reverb or an M/S-processed master
     * puts the same content in both channels at slightly different times. Summing gives
     * |1 + e^{-jwd}| = 2|cos(wd/2)| — a comb, with nulls at odd multiples of fs/2d.
     * Those notches look exactly like real tone to everything downstream.
     */
    it('does not comb-filter a Haas-widened take', () => {
      const delaySamples = 12; // fs/2d = 2 kHz, so nulls at 2 kHz, 6 kHz, 10 kHz...
      const left = noise(2);
      const right = delayed(left, delaySamples);

      const summed = magnitudesOf(monoMix(left, right));
      const incoherent = magnitudesOf([left, right]);

      // The mono mix carves a deep notch at the first null...
      const notchDepth = dbAt(summed, 6000) - dbAt(summed, 4000);
      expect(notchDepth).toBeLessThan(-10);

      // ...while the incoherent sum stays flat across the same span, because it never
      // had the chance to cancel.
      const incoherentTilt = dbAt(incoherent, 6000) - dbAt(incoherent, 4000);
      expect(Math.abs(incoherentTilt)).toBeLessThan(1.5);
    });

    it('measures dual mono identically to mono', () => {
      const signal = noise(3);
      const mono = magnitudesOf(signal);
      const dual = magnitudesOf([signal, signal]);

      // The /channelCount normalization is what makes this hold — without it, duplicating
      // a channel would read 3 dB louder and shift every level in the pipeline.
      expect(meanAbsDbDiff(mono, dual, 100, 16000)).toBeLessThan(0.01);
    });

    it('averages uncorrelated channels in power, not amplitude', () => {
      // Two independent noises at the same level: incoherent sum keeps that level.
      // A coherent mix would read 3 dB down, because uncorrelated signals partially
      // cancel when you add their waveforms.
      const level = magnitudesOf([noise(4), noise(5)]);
      const single = magnitudesOf(noise(4));

      expect(meanAbsDbDiff(level, single, 100, 16000)).toBeLessThan(0.5);
    });
  });

  describe('noise floor', () => {
    it('estimates the floor from the same incoherent sum as the signal', () => {
      // If the floor were measured on a mono mixdown while the signal came from a power
      // sum, anti-phase channels would give a silent floor against a full-level signal —
      // an SNR of +infinity, and the gate downstream would trust garbage.
      const left = noise(6);
      const right = inverted(left);

      const result = computeAveragedFFT([left, right], FFT_CONFIG, SAMPLE_RATE);
      expect(result.noiseFloor).toBeDefined();

      // Stationary noise: the floor estimate should land close to the measured spectrum,
      // i.e. ~0 dB SNR, which is what makes the gate stand down for material like this.
      const snrDb = meanAbsDbDiff(result.magnitudes, result.noiseFloor!, 500, 8000);
      expect(snrDb).toBeLessThan(3);
    });
  });

  describe('wavParser', () => {
    it('deinterleaves channels alongside the mono mix', async () => {
      const parsed = await parseWavFile(toneFile('sine-stereo'));

      expect(parsed.channels).toHaveLength(2);
      expect(parsed.channels[0].length).toBe(parsed.audioData.length);

      // The fixture is 1 kHz left / 440 Hz right, so the channels must differ and the
      // mono mix must be their average.
      let maxChannelDiff = 0;
      let maxMixError = 0;
      for (let i = 0; i < parsed.audioData.length; i++) {
        const [l, r] = [parsed.channels[0][i], parsed.channels[1][i]];
        maxChannelDiff = Math.max(maxChannelDiff, Math.abs(l - r));
        maxMixError = Math.max(maxMixError, Math.abs((l + r) / 2 - parsed.audioData[i]));
      }

      expect(maxChannelDiff).toBeGreaterThan(0.1);
      expect(maxMixError).toBeLessThan(1e-6);
    });

    it('gives a mono file a single channel', async () => {
      const parsed = await parseWavFile(toneFile('sine-1k'));
      expect(parsed.channels).toHaveLength(1);
      expect(parsed.channels[0]).toBe(parsed.audioData);
    });
  });
});
