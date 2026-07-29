import { describe, it, expect, beforeAll } from 'vitest';
import { deriveToneCurve, renderToneMatchIR } from '../../../src/services/dsp/irDerivation';
import { computeAveragedFFT } from '../../../src/services/audio/fftProcessor';
import { extractSpectrum } from '../../../src/services/dsp/spectrum';
import { irMagnitudeResponse } from '../../../src/services/dsp/irResponse';
import { DEFAULT_TONE_MATCH_CONFIG } from '../../../src/services/dsp/defaults';
import type { FFTConfig } from '../../../src/types/spectrum';
import type { ToneCurve } from '../../../src/types/ir';
import { loadSamples } from '../../fixtures';

const SAMPLE_RATE = 48000;
const FFT_CONFIG: FFTConfig = { fftSize: 2048, window: 'hann', overlap: 0.5 };

function spectrumOf(signal: Float32Array) {
  return extractSpectrum(computeAveragedFFT(signal, FFT_CONFIG, SAMPLE_RATE));
}

/** Filter gain in dB at a frequency, read off the rendered IR's actual response. */
function gainAt(response: ReturnType<typeof irMagnitudeResponse>, hz: number): number {
  const { frequencies, magnitudesDb } = response;
  const spacing = frequencies[1] - frequencies[0];
  const position = (hz - frequencies[0]) / spacing;
  const index = Math.max(0, Math.min(frequencies.length - 2, Math.floor(position)));
  const fraction = position - index;
  return magnitudesDb[index] + (magnitudesDb[index + 1] - magnitudesDb[index]) * fraction;
}

describe('IR rendering', () => {
  let curve: ToneCurve;

  beforeAll(async () => {
    const [flat, shaped] = await Promise.all([
      loadSamples('white-noise'),
      loadSamples('white-noise-eq'),
    ]);
    curve = deriveToneCurve(
      spectrumOf(flat),
      spectrumOf(shaped),
      SAMPLE_RATE,
      DEFAULT_TONE_MATCH_CONFIG,
    );
  });

  describe('rate invariance', () => {
    /**
     * The regression this whole split exists for.
     *
     * The old export path resampled a finished IR with linear interpolation, whose
     * triangular kernel gives a sinc²(f·T) response: about -1.5 dB at 10 kHz and -6.3 dB
     * at 20 kHz. Rendering the curve at each rate instead should put the same filter at
     * both, to well under the tolerance the rest of the pipeline is held to.
     */
    it('renders the same magnitude response at 44.1 and 48 kHz', () => {
      const at48 = irMagnitudeResponse(renderToneMatchIR(curve, 48000, 2048));
      const at441 = irMagnitudeResponse(renderToneMatchIR(curve, 44100, 2048));

      for (const hz of [1000, 5000, 10000, 16000, 20000]) {
        expect(Math.abs(gainAt(at48, hz) - gainAt(at441, hz))).toBeLessThan(0.2);
      }
    });

    it('holds unity gain above the curve\'s own Nyquist when rendered at a higher rate', () => {
      // The 48 kHz curve says nothing above 24 kHz. Rendering at 96 kHz must extrapolate
      // that as 0 dB rather than as whatever the last bin happened to hold.
      const at96 = irMagnitudeResponse(renderToneMatchIR(curve, 96000, 2048));
      for (const hz of [30000, 40000]) {
        expect(Math.abs(gainAt(at96, hz))).toBeLessThan(1);
      }
    });
  });

  describe('tap count', () => {
    it('agrees across lengths in the midband', () => {
      const short = irMagnitudeResponse(renderToneMatchIR(curve, SAMPLE_RATE, 1024));
      const long = irMagnitudeResponse(renderToneMatchIR(curve, SAMPLE_RATE, 4096));

      for (const hz of [500, 1000, 4000, 8000]) {
        expect(Math.abs(gainAt(short, hz) - gainAt(long, hz))).toBeLessThan(1);
      }
    });

    it('produces exactly the requested length at every offered size', () => {
      for (const taps of [512, 1024, 2048, 4096]) {
        const ir = renderToneMatchIR(curve, SAMPLE_RATE, taps);
        expect(ir.coefficients.length).toBe(taps);
        expect(ir.length).toBe(taps);
      }
    });
  });

  describe('L1 norm', () => {
    it('reports a norm that bounds the worst-case output peak', () => {
      const ir = renderToneMatchIR(curve, SAMPLE_RATE, 2048);
      const h = ir.coefficients;
      expect(ir.l1Norm).toBeGreaterThan(0);

      // The input that maximises |y[0]|: sign-matched to the filter, so every tap adds.
      // No signal can beat it, so if the trimmed chain survives this it survives anything.
      const worstCase = new Float32Array(h.length);
      for (let i = 0; i < h.length; i++) worstCase[i] = Math.sign(h[h.length - 1 - i]);

      let peak = 0;
      for (let n = 0; n < h.length; n++) {
        let acc = 0;
        for (let k = 0; k <= n; k++) acc += worstCase[n - k] * h[k];
        peak = Math.max(peak, Math.abs(acc));
      }

      expect(peak).toBeLessThanOrEqual(ir.l1Norm! + 1e-4);

      const trim = ir.l1Norm! > 1 ? 1 / ir.l1Norm! : 1;
      expect(peak * trim).toBeLessThanOrEqual(1 + 1e-6);
    });

    it('exceeds the largest boost — which is why the boost is not a safe trim', () => {
      const ir = renderToneMatchIR(curve, SAMPLE_RATE, 2048);
      const l1Db = 20 * Math.log10(ir.l1Norm!);
      expect(l1Db).toBeGreaterThan(ir.maxGainDb!);
    });
  });
});
