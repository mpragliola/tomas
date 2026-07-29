import { describe, it, expect } from 'vitest';
import { measureHeadroomTrim, loudestWindow } from '../../../src/services/audio/headroom';
import { convolveAudio } from '../../../src/services/audio/convolution';
import { computeAveragedFFT } from '../../../src/services/audio/fftProcessor';
import { extractSpectrum } from '../../../src/services/dsp/spectrum';
import { deriveToneMatchIR } from '../../../src/services/dsp/irDerivation';
import { DEFAULT_FFT_CONFIG, DEFAULT_TONE_MATCH_CONFIG } from '../../../src/services/dsp/defaults';
import { parseWavFile } from '../../../src/services/audio/wavParser';
import { toneFile } from '../../fixtures';

const RATE = 48000;

function noise(seed: number, length: number, amplitude: number): Float32Array {
  let state = seed;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (state / 2147483648 - 1) * amplitude;
  }
  return out;
}

describe('headroom measurement', () => {
  it('asks for no trim when the filtered signal does not reach full scale', () => {
    const quiet = noise(1, RATE * 2, 0.1);
    const ir = new Float32Array(64);
    ir[0] = 1;

    const { trim, peak } = measureHeadroomTrim(ir, [quiet], RATE);

    expect(peak).toBeLessThan(0.5);
    expect(trim).toBe(1);
  });

  it('trims exactly enough to park the peak just under full scale', () => {
    const hot = noise(2, RATE * 2, 0.9);
    const ir = new Float32Array(64);
    ir[0] = 2; // +6 dB, so the result is guaranteed to overshoot

    const { trim, peak } = measureHeadroomTrim(ir, [hot], RATE);

    expect(peak).toBeGreaterThan(1);
    // 1 dB of margin, i.e. the trimmed peak lands on 0.891
    expect(peak * trim).toBeCloseTo(Math.pow(10, -1 / 20), 5);
  });

  it('reads the peak off the loudest passage, not the head of the file', () => {
    const rate = 8000;
    const signal = new Float32Array(rate * 40);
    // Quiet for 30 s, then the loud part — well past a 10 s scan starting at zero
    signal.set(noise(3, rate * 30, 0.02), 0);
    signal.set(noise(4, rate * 10, 0.95), rate * 30);

    const ir = new Float32Array(64);
    ir[0] = 1;

    const { peak } = measureHeadroomTrim(ir, [signal], rate);
    expect(peak).toBeGreaterThan(0.8);
  });

  it('takes the loudest channel, so one hot side cannot clip', () => {
    const soft = noise(5, RATE * 2, 0.05);
    const loud = noise(6, RATE * 2, 0.95);
    const ir = new Float32Array(64);
    ir[0] = 1.5;

    const both = measureHeadroomTrim(ir, [soft, loud], RATE);
    const loudOnly = measureHeadroomTrim(ir, [loud], RATE);

    expect(both.trim).toBeCloseTo(loudOnly.trim, 6);
  });

  it('costs far less level than the L1 bound on a real tone-match IR', async () => {
    const [a, b] = await Promise.all([
      parseWavFile(toneFile('cab-noise')),
      parseWavFile(toneFile('cab-noise-eq')),
    ]);

    const spectrumOf = (signal: Float32Array) =>
      extractSpectrum(computeAveragedFFT(signal, DEFAULT_FFT_CONFIG, RATE));

    const ir = deriveToneMatchIR(
      spectrumOf(a.audioData),
      spectrumOf(b.audioData),
      RATE,
      DEFAULT_TONE_MATCH_CONFIG,
    );

    const { trim } = measureHeadroomTrim(ir.coefficients, [a.audioData], RATE);
    const measuredDb = 20 * Math.log10(trim);
    const l1Db = -20 * Math.log10(ir.l1Norm!);

    // The bound gives up about 11 dB on this fixture; the measurement must be far cheaper
    expect(l1Db).toBeLessThan(-8);
    expect(measuredDb).toBeGreaterThan(l1Db + 6);

    // ...and still enough: the filtered take must not exceed full scale
    const wet = convolveAudio({
      irCoefficients: ir.coefficients,
      audioData: a.audioData,
      sampleRate: RATE,
    });
    let peak = 0;
    for (let i = 0; i < wet.length; i++) peak = Math.max(peak, Math.abs(wet[i]) * trim);
    expect(peak).toBeLessThanOrEqual(1);
  });
});

describe('loudestWindow', () => {
  it('returns the signal untouched when it is shorter than the window', () => {
    const short = noise(7, 100, 0.5);
    expect(loudestWindow(short, 1000, 10)).toBe(short);
  });

  it('never runs off the end of the signal', () => {
    const signal = new Float32Array(1000);
    signal.set(noise(8, 200, 0.9), 800);
    const window = loudestWindow(signal, 300, 10);
    expect(window.length).toBe(300);
  });
});
