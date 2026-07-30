import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAnalysisStore } from '../../../src/stores/analysisStore';
import { computeAveragedFFT } from '../../../src/services/audio/fftProcessor';
import { extractSpectrum } from '../../../src/services/dsp/spectrum';
import { DEFAULT_FFT_CONFIG, DEFAULT_TONE_MATCH_CONFIG } from '../../../src/services/dsp/defaults';
import { encodeWavPcm } from '../../../src/utils/fileUtils';
import { loadSamples } from '../../fixtures';

const SAMPLE_RATE = 48000;

// Setting both spectra trips the store's auto-IR watcher, which schedules itself via
// `window.setTimeout`. This suite runs under vitest's node environment, so stub just
// enough of `window` for that watcher to resolve instead of rejecting unhandled.
(globalThis as any).window ??= globalThis;

/**
 * Regression coverage for the IR download producing a 44-byte (header-only) WAV.
 *
 * `irTaps` is exposed by the store as a ref-like getter object, not a real number,
 * so callers must read `.value` off it. Passing the object itself into
 * `new Float32Array(...)` silently yields a zero-length array instead of throwing,
 * which is exactly what shipped the bug — the WAV header writes fine, `dataSize` is 0.
 */
describe('analysisStore IR download', () => {
  let audioA: Float32Array;
  let audioB: Float32Array;

  beforeAll(async () => {
    [audioA, audioB] = await Promise.all([
      loadSamples('white-noise'),
      loadSamples('white-noise-eq'),
    ]);
  });

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('exposes irTaps.value as the configured number, not as the wrapper object', () => {
    const store = useAnalysisStore();
    expect(store.irTaps.value).toBe(DEFAULT_TONE_MATCH_CONFIG.taps);
    expect(typeof store.irTaps.value).toBe('number');
  });

  it('renders a full-length, non-empty IR at the export sample rate via .value', async () => {
    const store = useAnalysisStore();
    store.sampleRates.A = SAMPLE_RATE;
    store.sampleRates.B = SAMPLE_RATE;
    store.spectra.A = extractSpectrum(computeAveragedFFT(audioA, DEFAULT_FFT_CONFIG, SAMPLE_RATE));
    store.spectra.B = extractSpectrum(computeAveragedFFT(audioB, DEFAULT_FFT_CONFIG, SAMPLE_RATE));
    await store.computeToneMatchIR();

    const rendered = store.renderIRAt(44100, store.irTaps.value);

    expect(rendered).not.toBeNull();
    expect(rendered!.coefficients.length).toBe(DEFAULT_TONE_MATCH_CONFIG.taps);

    const wav = encodeWavPcm(rendered!.coefficients, 44100, 16);
    expect(wav.byteLength).toBeGreaterThan(44);
    expect(wav.byteLength).toBe(44 + DEFAULT_TONE_MATCH_CONFIG.taps * 2);
  });

  it('passing the wrapper object instead of .value reproduces the empty-WAV bug', async () => {
    const store = useAnalysisStore();
    store.sampleRates.A = SAMPLE_RATE;
    store.sampleRates.B = SAMPLE_RATE;
    store.spectra.A = extractSpectrum(computeAveragedFFT(audioA, DEFAULT_FFT_CONFIG, SAMPLE_RATE));
    store.spectra.B = extractSpectrum(computeAveragedFFT(audioB, DEFAULT_FFT_CONFIG, SAMPLE_RATE));
    await store.computeToneMatchIR();

    // @ts-expect-error intentionally passing the wrapper object, not a number
    const rendered = store.renderIRAt(44100, store.irTaps);

    expect(rendered!.coefficients.length).toBe(0);
    const wav = encodeWavPcm(rendered!.coefficients, 44100, 16);
    expect(wav.byteLength).toBe(44);
  });
});
