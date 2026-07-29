import { describe, it, expect, beforeAll } from 'vitest';
import { computeAveragedFFT } from '../../../src/services/audio/fftProcessor';
import { extractSpectrum } from '../../../src/services/dsp/spectrum';
import { deriveToneMatchIR } from '../../../src/services/dsp/irDerivation';
import {
  DEFAULT_FFT_CONFIG,
  DEFAULT_TONE_MATCH_CONFIG,
} from '../../../src/services/dsp/defaults';
import { loadTone } from '../../fixtures';
import { targetCurveDb } from '../../fixtures/curves.mjs';

/**
 * End-to-end accuracy of the tone match, measured rather than asserted structurally:
 * derive an IR from a fixture pair whose difference is a known EQ curve, then compare the
 * IR's actual frequency response against the curve it was supposed to reproduce.
 *
 * The pairs come from tests/fixtures/tones — `*-eq` is the same take with
 * `targetCurveDb` applied, so `targetCurveDb` here *is* the right answer, not an
 * approximation of it.
 */

const PROBE_FREQS = [
  40, 50, 80, 125, 200, 315, 500, 800, 1250, 2000, 3150, 5000, 8000, 10000, 16000, 20000,
];

function spectrumOf(signal: Float32Array, sampleRate: number) {
  return extractSpectrum(computeAveragedFFT(signal, DEFAULT_FFT_CONFIG, sampleRate));
}

/** True magnitude response of an FIR at the given frequencies, in dB. */
function firResponseDb(ir: Float32Array, freqs: number[], sampleRate: number): number[] {
  return freqs.map((frequency) => {
    let real = 0;
    let imag = 0;
    const omega = (2 * Math.PI * frequency) / sampleRate;
    for (let n = 0; n < ir.length; n++) {
      real += ir[n] * Math.cos(omega * n);
      imag -= ir[n] * Math.sin(omega * n);
    }
    return 20 * Math.log10(Math.hypot(real, imag) + 1e-30);
  });
}

/** Response error vs `want`, with the constant level difference removed. */
function shapeErrors(got: number[], want: number[]): number[] {
  const fitBins = PROBE_FREQS.map((f, i) => (f >= 200 && f <= 4000 ? i : -1)).filter((i) => i >= 0);
  const offset = fitBins.reduce((sum, i) => sum + (got[i] - want[i]), 0) / fitBins.length;
  return got.map((value, i) => value - offset - want[i]);
}

function maxErrorInBand(errors: number[], lowHz: number, highHz: number): number {
  let worst = 0;
  PROBE_FREQS.forEach((f, i) => {
    if (f >= lowHz && f <= highHz) worst = Math.max(worst, Math.abs(errors[i]));
  });
  return worst;
}

/** Derive the IR for a working/reference fixture pair, at the working take's rate. */
async function matchFixtures(workingName: string, referenceName: string) {
  const [working, reference] = await Promise.all([loadTone(workingName), loadTone(referenceName)]);
  const ir = deriveToneMatchIR(
    spectrumOf(working.audioData, working.sampleRate),
    spectrumOf(reference.audioData, reference.sampleRate),
    working.sampleRate,
    DEFAULT_TONE_MATCH_CONFIG,
  );
  return { ir, sampleRate: working.sampleRate };
}

describe('tone match accuracy', () => {
  it('reproduces a known EQ curve to within a few tenths of a dB', async () => {
    const { ir, sampleRate } = await matchFixtures('white-noise', 'white-noise-eq');

    const errors = shapeErrors(
      firResponseDb(ir.coefficients, PROBE_FREQS, sampleRate),
      PROBE_FREQS.map(targetCurveDb),
    );

    // Inside the match band the filter should be near-exact.
    expect(maxErrorInBand(errors, 50, DEFAULT_TONE_MATCH_CONFIG.matchHighHz!)).toBeLessThan(0.5);
  });

  it('survives a sample-rate mismatch between the two takes', async () => {
    // The reference is at 44.1 kHz, so its bins sit at different frequencies from the
    // 48 kHz working take's. Comparing bin index to bin index would skew the whole curve
    // by the rate ratio.
    const { ir, sampleRate } = await matchFixtures('cab-noise', 'cab-noise-44100');
    expect(sampleRate).toBe(48000);

    const errors = shapeErrors(
      firResponseDb(ir.coefficients, PROBE_FREQS, sampleRate),
      PROBE_FREQS.map(targetCurveDb),
    );

    expect(maxErrorInBand(errors, 125, 5000)).toBeLessThan(1);
  });

  it('does not turn a noise-floor difference into a tone difference', async () => {
    // Same tone in both takes, but `mixed-program-loud-hiss` is 23 dB hissier. Above the
    // cab rolloff hiss *is* the measured spectrum, so the raw ratio there is a difference
    // of noise, not of tone. The honest answer is a flat filter; this produced +18 dB of
    // hiss boost at 16 kHz before the noise-floor gate existed.
    const [working, reference] = await Promise.all([
      loadTone('mixed-program-quiet-hiss'),
      loadTone('mixed-program-loud-hiss'),
    ]);
    const ir = deriveToneMatchIR(
      spectrumOf(working.audioData, working.sampleRate),
      spectrumOf(reference.audioData, reference.sampleRate),
      working.sampleRate,
      { ...DEFAULT_TONE_MATCH_CONFIG, snrFloorDb: 3, snrFullDb: 12 },
    );
    const sampleRate = working.sampleRate;

    const response = firResponseDb(ir.coefficients, PROBE_FREQS, sampleRate);

    // Flat across the band the material actually occupies. The bound is looser below
    // 100 Hz because a 1/6-octave band down there spans only a couple of bins, so two
    // independent takes genuinely differ by around a dB no matter how good the match is.
    PROBE_FREQS.forEach((frequency, i) => {
      if (frequency < 40 || frequency > 8000) return;
      expect(Math.abs(response[i]), `${frequency} Hz`).toBeLessThan(frequency < 100 ? 1.5 : 1);
    });

    // ...and nothing at all where there is only hiss, even though `matchHighHz` is 20 kHz
    // and would happily pass a correction there.
    expect(Math.abs(response[PROBE_FREQS.indexOf(16000)])).toBeLessThan(0.5);
    expect(Math.abs(response[PROBE_FREQS.indexOf(20000)])).toBeLessThan(0.5);
  });

  it('reports 0 dB SNR on stationary noise, so the gate knows to stand down', async () => {
    // Calibration check for the minimum-statistics estimator: fed a signal that is pure
    // stationary noise, its floor estimate should land on the signal's own level. If this
    // drifts, every SNR-gated decision downstream drifts with it.
    const white = await loadTone('white-noise');
    const spectrum = spectrumOf(white.audioData, white.sampleRate);
    expect(spectrum.noiseFloorLinear).toBeDefined();

    const snr: number[] = [];
    for (let i = 1; i < spectrum.magnitudesLinear.length; i++) {
      snr.push(
        20 *
          Math.log10(
            Math.max(spectrum.magnitudesLinear[i], 1e-12) /
              Math.max(spectrum.noiseFloorLinear![i], 1e-12),
          ),
      );
    }
    snr.sort((a, b) => a - b);
    const median = snr[Math.floor(snr.length / 2)];
    expect(Math.abs(median)).toBeLessThan(1.5);
  });

  it('keeps the matched level: the IR is not rescaled to tame its peak sample', async () => {
    // A minimum-phase filter's first sample routinely exceeds 1. Scaling the IR to force
    // it under quietly attenuated the whole match by up to 7 dB.
    const { ir, sampleRate } = await matchFixtures('white-noise', 'white-noise-eq');
    const response = firResponseDb(ir.coefficients, PROBE_FREQS, sampleRate);

    // Level averaged per octave over the level band should sit near the target's.
    const meanOf = (values: (i: number) => number) => {
      let sum = 0;
      let weight = 0;
      PROBE_FREQS.forEach((f, i) => {
        if (f < 100 || f > 8000) return;
        sum += values(i) / f;
        weight += 1 / f;
      });
      return sum / weight;
    };

    const got = meanOf((i) => response[i]);
    const want = meanOf((i) => targetCurveDb(PROBE_FREQS[i]));
    expect(Math.abs(got - want)).toBeLessThan(1);
  });
});
