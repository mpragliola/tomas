import type { GraphicEqBand, GraphicEqState } from '../../types/graphicEq';
import type { ToneCurve } from '../../types/ir';

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * RBJ Audio EQ Cookbook coefficients, normalized so a0 = 1. These are the same formulas
 * the Web Audio spec uses for `BiquadFilterNode` — matched deliberately, even though this
 * app never actually creates one of those nodes for the graphic EQ (see `applyGraphicEq`):
 * the correction is baked into the tone-match IR instead, so the curve this produces is
 * the one thing standing in for "what a real biquad chain would sound like".
 */
export function biquadCoefficients(band: GraphicEqBand, sampleRate: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * band.frequency) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * band.q);

  switch (band.type) {
    case 'peaking': {
      const A = Math.pow(10, band.gain / 40);
      const a0 = 1 + alpha / A;
      return {
        b0: (1 + alpha * A) / a0,
        b1: (-2 * cosW0) / a0,
        b2: (1 - alpha * A) / a0,
        a1: (-2 * cosW0) / a0,
        a2: (1 - alpha / A) / a0,
      };
    }
    case 'lowshelf': {
      const A = Math.pow(10, band.gain / 40);
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      const a0 = A + 1 + (A - 1) * cosW0 + twoSqrtAAlpha;
      return {
        b0: (A * (A + 1 - (A - 1) * cosW0 + twoSqrtAAlpha)) / a0,
        b1: (2 * A * (A - 1 - (A + 1) * cosW0)) / a0,
        b2: (A * (A + 1 - (A - 1) * cosW0 - twoSqrtAAlpha)) / a0,
        a1: (-2 * (A - 1 + (A + 1) * cosW0)) / a0,
        a2: (A + 1 + (A - 1) * cosW0 - twoSqrtAAlpha) / a0,
      };
    }
    case 'highshelf': {
      const A = Math.pow(10, band.gain / 40);
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      const a0 = A + 1 - (A - 1) * cosW0 + twoSqrtAAlpha;
      return {
        b0: (A * (A + 1 + (A - 1) * cosW0 + twoSqrtAAlpha)) / a0,
        b1: (-2 * A * (A - 1 + (A + 1) * cosW0)) / a0,
        b2: (A * (A + 1 + (A - 1) * cosW0 - twoSqrtAAlpha)) / a0,
        a1: (2 * (A - 1 - (A + 1) * cosW0)) / a0,
        a2: (A + 1 - (A - 1) * cosW0 - twoSqrtAAlpha) / a0,
      };
    }
    case 'lowpass': {
      const a0 = 1 + alpha;
      return {
        b0: (1 - cosW0) / 2 / a0,
        b1: (1 - cosW0) / a0,
        b2: (1 - cosW0) / 2 / a0,
        a1: (-2 * cosW0) / a0,
        a2: (1 - alpha) / a0,
      };
    }
    case 'highpass': {
      const a0 = 1 + alpha;
      return {
        b0: (1 + cosW0) / 2 / a0,
        b1: (-(1 + cosW0)) / a0,
        b2: (1 + cosW0) / 2 / a0,
        a1: (-2 * cosW0) / a0,
        a2: (1 - alpha) / a0,
      };
    }
    case 'notch': {
      const a0 = 1 + alpha;
      return {
        b0: 1 / a0,
        b1: (-2 * cosW0) / a0,
        b2: 1 / a0,
        a1: (-2 * cosW0) / a0,
        a2: (1 - alpha) / a0,
      };
    }
  }
}

/**
 * |H(f)| in dB at arbitrary frequencies, evaluated analytically rather than via FFT —
 * unlike `irResponse.ts`'s `irMagnitudeResponse`, which only works on a rendered time-
 * domain filter. Being analytic is what lets this line up exactly with `toneCurve`'s own
 * (arbitrary, non-uniform) frequency grid with no resampling.
 *
 * Magnitude-squared of each z-domain quadratic is expanded with a trig identity instead
 * of complex arithmetic: for c0 + c1*z^-1 + c2*z^-2 at z = e^{jw},
 * |·|² = c0²+c1²+c2² + 2(c0c1+c1c2)cos(w) + 2c0c2cos(2w).
 */
export function biquadResponseDb(
  coeffs: BiquadCoeffs,
  frequencies: Float32Array,
  sampleRate: number,
): Float32Array {
  const { b0, b1, b2, a1, a2 } = coeffs;
  const out = new Float32Array(frequencies.length);

  for (let i = 0; i < frequencies.length; i++) {
    const w = (2 * Math.PI * frequencies[i]) / sampleRate;
    const cosW = Math.cos(w);
    const cos2W = Math.cos(2 * w);

    const numSq = b0 * b0 + b1 * b1 + b2 * b2 + 2 * (b0 * b1 + b1 * b2) * cosW + 2 * b0 * b2 * cos2W;
    const denSq = 1 + a1 * a1 + a2 * a2 + 2 * (a1 + a1 * a2) * cosW + 2 * a2 * cos2W;

    out[i] = 10 * Math.log10(Math.max(numSq, 1e-24) / Math.max(denSq, 1e-24));
  }

  return out;
}

export function bandResponseDb(
  band: GraphicEqBand,
  frequencies: Float32Array,
  sampleRate: number,
): Float32Array {
  return biquadResponseDb(biquadCoefficients(band, sampleRate), frequencies, sampleRate);
}

/**
 * Combined response of every enabled band, summed in dB — correct because summing dB is
 * cascading in series, the same topology a real biquad chain would use.
 */
export function graphicEqResponseDb(
  bands: GraphicEqBand[],
  frequencies: Float32Array,
  sampleRate: number,
): Float32Array {
  const out = new Float32Array(frequencies.length);
  for (const band of bands) {
    if (!band.enabled) continue;
    const bandDb = bandResponseDb(band, frequencies, sampleRate);
    for (let i = 0; i < out.length; i++) out[i] += bandDb[i];
  }
  return out;
}

/**
 * The tone-match curve with the graphic EQ's correction added on top, in dB. A disabled
 * master (or a master with every band disabled) is a provable no-op: `graphicEqResponseDb`
 * returns all zeros, so `curveDb` comes back unchanged.
 */
export function applyGraphicEq(
  curve: ToneCurve,
  eq: GraphicEqState,
  sampleRate: number,
): ToneCurve {
  if (!eq.enabled) return curve;

  const eqDb = graphicEqResponseDb(eq.bands, curve.frequencies, sampleRate);
  const curveDb = new Float32Array(curve.curveDb.length);
  let maxGainDb = 0;
  for (let i = 0; i < curveDb.length; i++) {
    curveDb[i] = curve.curveDb[i] + eqDb[i];
    if (curveDb[i] > maxGainDb) maxGainDb = curveDb[i];
  }

  return { frequencies: curve.frequencies, curveDb, maxGainDb, offsetDb: curve.offsetDb };
}
