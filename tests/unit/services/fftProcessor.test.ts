import { describe, it, expect, beforeAll } from 'vitest';
import { computeFFT, computeAveragedFFT } from '../../../src/services/audio/fftProcessor';
import type { FFTConfig } from '../../../src/types/spectrum';
import { loadSamples } from '../../fixtures';

const RATE = 48000;
const CONFIG: FFTConfig = { fftSize: 8192, window: 'hann', overlap: 0.75 };

/** Mean level in dB over a frequency band, from a linear magnitude spectrum. */
function bandDb(
  frequencies: Float32Array,
  magnitudes: Float32Array,
  lowHz: number,
  highHz: number,
): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < frequencies.length; i++) {
    if (frequencies[i] < lowHz || frequencies[i] > highHz) continue;
    sum += 20 * Math.log10(magnitudes[i] + 1e-30);
    count++;
  }
  return sum / count;
}

function peaksAbove(
  frequencies: Float32Array,
  magnitudes: Float32Array,
  fraction: number,
): number[] {
  const threshold = Math.max(...magnitudes) * fraction;
  const peaks: number[] = [];
  for (let i = 1; i < magnitudes.length - 1; i++) {
    if (
      magnitudes[i] > threshold &&
      magnitudes[i] >= magnitudes[i - 1] &&
      magnitudes[i] > magnitudes[i + 1]
    ) {
      peaks.push(frequencies[i]);
    }
  }
  return peaks;
}

describe('fftProcessor', () => {
  let sine1k: Float32Array;
  let chord: Float32Array;
  let sweep: Float32Array;
  let white: Float32Array;

  beforeAll(async () => {
    [sine1k, chord, sweep, white] = await Promise.all([
      loadSamples('sine-1k'),
      loadSamples('chord-a-major'),
      loadSamples('sweep-log-20-20k'),
      loadSamples('white-noise'),
    ]);
  });

  it('computes the FFT of a sine at the right bin and the right level', () => {
    const result = computeFFT(sine1k, CONFIG, RATE);

    expect(result.magnitudes.length).toBe(CONFIG.fftSize / 2);
    // Present here because this is a single-frame transform; the Welch average omits it.
    expect(result.phases!.length).toBe(CONFIG.fftSize / 2);
    expect(result.frequencies.length).toBe(CONFIG.fftSize / 2);

    const peakBin = result.magnitudes.indexOf(Math.max(...result.magnitudes));
    expect(Math.abs(result.frequencies[peakBin] - 1000)).toBeLessThanOrEqual(RATE / CONFIG.fftSize);

    // The normalisation is amplitude-correct: a 0.5-amplitude sine reads 0.5 x the
    // window's coherent gain (0.5 for Hann), i.e. 0.25 — less up to 1.4 dB of scalloping
    // because 1 kHz falls between bins at this size.
    expect(result.magnitudes[peakBin]).toBeGreaterThan(0.2);
    expect(result.magnitudes[peakBin]).toBeLessThan(0.26);
  });

  it('resolves the three tones of a chord as three separate peaks', () => {
    const result = computeFFT(chord, CONFIG, RATE);
    const peaks = peaksAbove(result.frequencies, result.magnitudes, 0.25);

    // 220 / 277.18 / 329.63 Hz are 47 Hz apart at the closest; 5.9 Hz bins see all three.
    expect(peaks.length).toBe(3);
    [220, 277.18, 329.63].forEach((expected, i) => {
      expect(Math.abs(peaks[i] - expected)).toBeLessThan(RATE / CONFIG.fftSize);
    });
  });

  it('windows the frame: Hann suppresses the leakage a rectangular window leaves', () => {
    // 1 kHz falls between bins at this size (170.67 bins in), so an unwindowed frame
    // smears energy across the whole spectrum. That skirt is what windowing is for.
    const hann = computeFFT(sine1k, { ...CONFIG, window: 'hann' }, RATE);
    const rectangular = computeFFT(sine1k, { ...CONFIG, window: 'rectangular' }, RATE);

    const skirtHann = bandDb(hann.frequencies, hann.magnitudes, 4000, 12000);
    const skirtRectangular = bandDb(rectangular.frequencies, rectangular.magnitudes, 4000, 12000);

    expect(skirtHann).toBeLessThan(skirtRectangular - 20);
  });

  it('handles every supported FFT size, and finds the same tone in each', () => {
    for (const fftSize of [512, 1024, 2048, 4096, 8192, 16384] as const) {
      const result = computeFFT(sine1k, { ...CONFIG, fftSize }, RATE);

      expect(result.magnitudes.length, `${fftSize}`).toBe(fftSize / 2);
      expect(result.frequencies[1], `${fftSize}`).toBeCloseTo(RATE / fftSize, 6);

      const peakBin = result.magnitudes.indexOf(Math.max(...result.magnitudes));
      expect(Math.abs(result.frequencies[peakBin] - 1000), `${fftSize}`).toBeLessThanOrEqual(
        RATE / fftSize,
      );
    }
  });

  it('averages the whole take rather than only its first frame', () => {
    // A sweep is the clearest case: its first 8192 samples are the bottom of the sweep and
    // nothing else, so a single-frame FFT reports an empty top end while the average sees
    // the whole 20 Hz - 20 kHz range.
    const single = computeFFT(sweep, CONFIG, RATE);
    const averaged = computeAveragedFFT(sweep, CONFIG, RATE);

    const singleHigh = bandDb(single.frequencies, single.magnitudes, 8000, 16000);
    const averagedHigh = bandDb(averaged.frequencies, averaged.magnitudes, 8000, 16000);

    expect(averagedHigh).toBeGreaterThan(singleHigh + 20);

    // Equal energy per octave means the averaged per-bin level falls ~3 dB/octave.
    const octaveSlope =
      (bandDb(averaged.frequencies, averaged.magnitudes, 9000, 11000) -
        bandDb(averaged.frequencies, averaged.magnitudes, 90, 110)) /
      Math.log2(100);
    expect(octaveSlope).toBeGreaterThan(-4);
    expect(octaveSlope).toBeLessThan(-2);
  });

  it('measures white noise as flat, and estimates its noise floor', () => {
    const averaged = computeAveragedFFT(white, CONFIG, RATE);

    const octaveSlope =
      (bandDb(averaged.frequencies, averaged.magnitudes, 1800, 2200) -
        bandDb(averaged.frequencies, averaged.magnitudes, 450, 550)) /
      2;
    expect(Math.abs(octaveSlope)).toBeLessThan(0.5);

    // Stationary noise *is* its own floor, so the estimate should land on the measurement.
    expect(averaged.noiseFloor).toBeDefined();
    const floorDb = bandDb(averaged.frequencies, averaged.noiseFloor!, 500, 5000);
    const signalDb = bandDb(averaged.frequencies, averaged.magnitudes, 500, 5000);
    expect(Math.abs(signalDb - floorDb)).toBeLessThan(2);
  });
});
