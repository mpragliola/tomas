import FFT from 'fft.js';
import type { ImpulseResponse, IRDerivationConfig } from '../../types/ir';
import type { FrequencySpectrum } from '../../types/spectrum';
import { logger } from '../logging';

export function deriveIR(
  spectrumA: FrequencySpectrum,
  spectrumB: FrequencySpectrum,
  config: IRDerivationConfig,
  sampleRate = 44100,
): ImpulseResponse {
  logger.info('irDerivation', 'Deriving IR', {
    method: config.method,
    phase: config.phase,
    maxLength: config.maxLength,
  });

  const { magnitudesLinear: magA, phase: phaseB } = spectrumA;
  const { magnitudesLinear: magB } = spectrumB;

  // Ensure same length
  const binCount = Math.min(magA.length, magB.length);

  // Compute IR magnitude in frequency domain
  const irMagDomain = new Float32Array(binCount);

  if (config.method === 'difference') {
    for (let i = 0; i < binCount; i++) {
      irMagDomain[i] = magA[i] - magB[i];
    }
  } else {
    // ratio: A/B in linear, convert to dB, then back if needed
    for (let i = 0; i < binCount; i++) {
      const magBClamped = Math.max(magB[i], 1e-10);
      irMagDomain[i] = magA[i] / magBClamped;
    }
  }

  // Use phase from B (preserve-B strategy is simpler)
  const irPhase = phaseB.slice(0, binCount);

  // Convert to time domain via IFFT
  const fftSize = binCount * 2;
  const fft = new FFT(fftSize);

  const freqDomain = fft.createComplexArray();
  for (let i = 0; i < binCount; i++) {
    const real = irMagDomain[i] * Math.cos(irPhase[i]);
    const imag = irMagDomain[i] * Math.sin(irPhase[i]);
    freqDomain[i * 2] = real;
    freqDomain[i * 2 + 1] = imag;
  }
  // Mirror for negative frequencies (IFFT)
  for (let i = binCount; i < fftSize; i++) {
    freqDomain[i * 2] = 0;
    freqDomain[i * 2 + 1] = 0;
  }

  const timeDomain = fft.createComplexArray();
  fft.inverseTransform(timeDomain, freqDomain);

  // Extract real part and truncate
  const irFull = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    irFull[i] = timeDomain[i * 2];
  }

  // Truncate by energy threshold
  const irTruncated = truncateByEnergy(irFull, config.truncationDb);
  const irLimited = irTruncated.slice(0, config.maxLength);

  logger.info('irDerivation', 'IR derived', {
    lengthSamples: irLimited.length,
    energy: computeEnergy(irLimited),
    sampleRate,
  });

  return {
    coefficients: irLimited,
    length: irLimited.length,
    sampleRate,
  };
}

export interface ToneMatchConfig {
  /** FIR length in samples. IR loaders expect a power of two, typically 512-4096. */
  taps: number;
  /** Limit on how much the curve may boost or cut, in dB. */
  maxBoostDb?: number;
  /** Fractional-octave smoothing width, e.g. 1/6. */
  smoothingOctave?: number;
}

/**
 * Build a tone-matching IR: load it after `working` and it takes on the tone of `reference`.
 *
 * The correction is the smoothed magnitude ratio reference/working, rendered as a
 * minimum-phase FIR. Minimum phase is what a hardware IR loader expects — using the
 * program material's own phase (as deriveIR does) yields a smeared, unusable filter.
 */
export function deriveToneMatchIR(
  working: FrequencySpectrum,
  reference: FrequencySpectrum,
  sampleRate: number,
  config: ToneMatchConfig,
): ImpulseResponse {
  const { taps } = config;
  const maxBoostDb = config.maxBoostDb ?? 18;
  const smoothingOctave = config.smoothingOctave ?? 1 / 6;

  const binCount = Math.min(
    working.magnitudesLinear.length,
    reference.magnitudesLinear.length,
  );
  const freqs = working.frequencies;

  logger.info('irDerivation', 'Deriving tone-match IR', {
    taps,
    maxBoostDb,
    smoothingOctave,
    sampleRate,
    bins: binCount,
  });

  // Gate near-silent bins against each spectrum's own noise floor, so bands where
  // there is no signal don't produce enormous corrections.
  const floorWorking = peakOf(working.magnitudesLinear, binCount) * 1e-5;
  const floorReference = peakOf(reference.magnitudesLinear, binCount) * 1e-5;

  const correctionDb = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    const a = Math.max(working.magnitudesLinear[i], floorWorking);
    const b = Math.max(reference.magnitudesLinear[i], floorReference);
    correctionDb[i] = 20 * Math.log10(b / a);
  }

  const smoothed = smoothFractionalOctave(freqs, correctionDb, binCount, smoothingOctave);

  // Remove the overall level difference so the IR is a tone curve, not a volume change.
  const offsetDb = meanDbInBand(freqs, smoothed, binCount, 100, 8000);
  for (let i = 0; i < binCount; i++) {
    smoothed[i] = clamp(smoothed[i] - offsetDb, -maxBoostDb, maxBoostDb);
  }

  // Oversample the cepstrum FFT so truncating to `taps` doesn't wrap the tail back in.
  const fftLen = nextPowerOfTwo(taps * 4);
  const coefficients = minimumPhaseFromMagnitude(
    smoothed,
    freqs,
    binCount,
    fftLen,
    taps,
    sampleRate,
  );

  fadeOutTail(coefficients);
  const peakValue = normalizePeak(coefficients, 0.9);

  logger.info('irDerivation', 'Tone-match IR derived', {
    taps: coefficients.length,
    offsetDb: offsetDb.toFixed(2),
    peakBeforeNormalise: peakValue.toExponential(2),
  });

  return {
    coefficients,
    length: coefficients.length,
    sampleRate,
  };
}

/** Minimum-phase FIR from a dB magnitude curve, via the real-cepstrum method. */
function minimumPhaseFromMagnitude(
  curveDb: Float32Array,
  freqs: Float32Array,
  binCount: number,
  fftLen: number,
  taps: number,
  sampleRate: number,
): Float32Array {
  const half = fftLen / 2;
  const fft = new FFT(fftLen);

  // log|H| over the full symmetric spectrum
  const logSpectrum = fft.createComplexArray();
  for (let k = 0; k <= half; k++) {
    const frequency = (k * sampleRate) / fftLen;
    const lnMag = (interpolateDb(freqs, curveDb, binCount, frequency) / 20) * Math.LN10;
    logSpectrum[k * 2] = lnMag;
    if (k > 0 && k < half) {
      logSpectrum[(fftLen - k) * 2] = lnMag;
    }
  }

  // Real cepstrum, then fold the anti-causal half onto the causal half.
  const cepstrum = fft.createComplexArray();
  fft.inverseTransform(cepstrum, logSpectrum);

  const folded = fft.createComplexArray();
  folded[0] = cepstrum[0];
  for (let n = 1; n < half; n++) {
    folded[n * 2] = 2 * cepstrum[n * 2];
  }
  folded[half * 2] = cepstrum[half * 2];

  // exp of the folded cepstrum's spectrum is the minimum-phase transfer function.
  const logMinPhase = fft.createComplexArray();
  fft.transform(logMinPhase, folded);

  const transfer = fft.createComplexArray();
  for (let k = 0; k < fftLen; k++) {
    const magnitude = Math.exp(logMinPhase[k * 2]);
    const phase = logMinPhase[k * 2 + 1];
    transfer[k * 2] = magnitude * Math.cos(phase);
    transfer[k * 2 + 1] = magnitude * Math.sin(phase);
  }

  const impulse = fft.createComplexArray();
  fft.inverseTransform(impulse, transfer);

  const out = new Float32Array(taps);
  for (let i = 0; i < taps; i++) {
    out[i] = impulse[i * 2];
  }
  return out;
}

function smoothFractionalOctave(
  freqs: Float32Array,
  valuesDb: Float32Array,
  binCount: number,
  fraction: number,
): Float32Array {
  const prefix = new Float64Array(binCount + 1);
  for (let i = 0; i < binCount; i++) {
    prefix[i + 1] = prefix[i] + valuesDb[i];
  }

  const spacing = freqs[1] || 1;
  const halfWidth = Math.pow(2, fraction / 2);
  const out = new Float32Array(binCount);

  for (let i = 0; i < binCount; i++) {
    const frequency = freqs[i];
    if (frequency <= 0) {
      out[i] = valuesDb[i];
      continue;
    }
    const lo = Math.max(0, Math.floor(frequency / halfWidth / spacing));
    const hi = Math.min(binCount - 1, Math.ceil((frequency * halfWidth) / spacing));
    const count = Math.max(1, hi - lo + 1);
    out[i] = (prefix[hi + 1] - prefix[lo]) / count;
  }

  return out;
}

function meanDbInBand(
  freqs: Float32Array,
  valuesDb: Float32Array,
  binCount: number,
  lowHz: number,
  highHz: number,
): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < binCount; i++) {
    if (freqs[i] >= lowHz && freqs[i] <= highHz) {
      sum += valuesDb[i];
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

function interpolateDb(
  freqs: Float32Array,
  curveDb: Float32Array,
  binCount: number,
  frequency: number,
): number {
  const spacing = freqs[1] || 1;
  const position = frequency / spacing;

  if (position <= 0) return curveDb[0];
  if (position >= binCount - 1) return curveDb[binCount - 1];

  const index = Math.floor(position);
  const fraction = position - index;
  return curveDb[index] + (curveDb[index + 1] - curveDb[index]) * fraction;
}

/** Half-Hann fade over the tail so truncation doesn't leave a step. */
function fadeOutTail(ir: Float32Array): void {
  const fadeLength = Math.max(1, Math.floor(ir.length * 0.25));
  const start = ir.length - fadeLength;
  for (let i = 0; i < fadeLength; i++) {
    ir[start + i] *= 0.5 * (1 + Math.cos((Math.PI * i) / fadeLength));
  }
}

function normalizePeak(ir: Float32Array, target: number): number {
  const peakValue = peakOf(ir, ir.length);
  if (peakValue === 0) return 0;
  const gain = target / peakValue;
  for (let i = 0; i < ir.length; i++) {
    ir[i] *= gain;
  }
  return peakValue;
}

function peakOf(values: Float32Array, count: number): number {
  let max = 0;
  for (let i = 0; i < count; i++) {
    const magnitude = Math.abs(values[i]);
    if (magnitude > max) max = magnitude;
  }
  return max;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function truncateByEnergy(ir: Float32Array, thresholdDb: number): Float32Array {
  let totalEnergy = 0;
  for (let i = 0; i < ir.length; i++) {
    totalEnergy += ir[i] * ir[i];
  }

  if (totalEnergy === 0) return ir;

  // Drop the tail that holds less than `thresholdDb` of the total energy, i.e. keep
  // accumulating until everything above that threshold is captured.
  const tailFraction = Math.pow(10, thresholdDb / 10);
  const keepEnergy = totalEnergy * (1 - tailFraction);

  let accum = 0;
  for (let i = 0; i < ir.length; i++) {
    accum += ir[i] * ir[i];
    if (accum >= keepEnergy) {
      return ir.slice(0, i + 1);
    }
  }

  return ir;
}

function computeEnergy(signal: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < signal.length; i++) {
    sum += signal[i] * signal[i];
  }
  return sum;
}
