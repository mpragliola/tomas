import FFT from 'fft.js';
import type { ImpulseResponse, ToneCurve } from '../../types/ir';
import type { FrequencySpectrum } from '../../types/spectrum';
import { logger } from '../logging';

export interface ToneMatchConfig {
  /** FIR length in samples. IR loaders expect a power of two, typically 512-4096. */
  taps: number;
  /** Largest boost the curve may apply, in dB. Boosts amplify noise, so keep this low. */
  maxBoostDb?: number;
  /** Largest cut the curve may apply, in dB (positive number). Cuts are safe. */
  maxCutDb?: number;
  /** Fractional-octave smoothing width, e.g. 1/6. */
  smoothingOctave?: number;
  /**
   * Absolute floor on the smoothing bandwidth, in Hz. A 1/6-octave band at 60 Hz is
   * only 7 Hz wide — narrower than the analysis resolution — so without this the low
   * end is left effectively unsmoothed and its noise turns into real filter ripple.
   */
  minSmoothingHz?: number;
  /** Correction applies in full inside this band and tapers to 0 dB outside it. */
  matchLowHz?: number;
  matchHighHz?: number;
  /** Width of that taper, in octaves. Wider is gentler but lets more junk through. */
  taperOctaves?: number;
  /** Bins this far below their own spectrum's smoothed peak get no correction... */
  floorRelDb?: number;
  /** ...and full correction once they are within this much of it. */
  fullRelDb?: number;
  /** Bins this close to their own take's estimated noise floor get no correction... */
  snrFloorDb?: number;
  /** ...and full correction once they sit this far above it. */
  snrFullDb?: number;
  /**
   * If even a take's louder bins do not clear this much SNR, its noise-floor estimate is
   * meaningless rather than merely imprecise, and the gate switches off. Stationary noise
   * measures ~1 dB here; real playing measures 15-20 dB.
   */
  minUsableSnrDb?: number;
  /** Band whose mean level is removed, so the IR is a tone curve and not a volume change. */
  levelBandHz?: [number, number];
}

export type ResolvedToneMatchConfig = Required<ToneMatchConfig>;

export const TONE_MATCH_DEFAULTS: Omit<ResolvedToneMatchConfig, 'taps'> = {
  maxBoostDb: 12,
  maxCutDb: 24,
  smoothingOctave: 1 / 6,
  minSmoothingHz: 20,
  matchLowHz: 30,
  // Wide enough to be a backstop rather than a policy. The noise-floor gate is what
  // keeps hiss out of the correction, and it is per-bin and evidence-based; this band
  // only bounds it. Set lower and it starts refusing to match top end that is genuinely
  // there — measured at 2 dB lost at 18 kHz and 5.5 dB at 20 kHz with a 16 kHz edge, on
  // material that really had content up there. `bandWeight` clamps it to Nyquist.
  matchHighHz: 20000,
  taperOctaves: 0.6,
  floorRelDb: -80,
  fullRelDb: -65,
  snrFloorDb: -200,
  snrFullDb: -199,
  minUsableSnrDb: 6,
  levelBandHz: [100, 8000],
};

function resolveConfig(config: ToneMatchConfig): ResolvedToneMatchConfig {
  const defined = Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined),
  );
  return { ...TONE_MATCH_DEFAULTS, ...defined } as ResolvedToneMatchConfig;
}

/**
 * Build a tone-matching IR: load it after `working` and it takes on the tone of `reference`.
 *
 * Thin composition of the two halves below — derive the curve, then render it. Callers that
 * need to re-render at another rate or tap count should hold the `ToneCurve` and call
 * `renderToneMatchIR` again rather than resampling the result.
 */
export function deriveToneMatchIR(
  working: FrequencySpectrum,
  reference: FrequencySpectrum,
  sampleRate: number,
  config: ToneMatchConfig,
): ImpulseResponse {
  const curve = deriveToneCurve(working, reference, sampleRate, config);
  return renderToneMatchIR(curve, sampleRate, resolveConfig(config).taps);
}

/**
 * The tone correction as a frequency curve: the smoothed magnitude ratio reference/working,
 * levelled and trust-weighted, but not yet a filter.
 *
 * `reference` is resampled onto `working`'s frequency grid, so the two takes may have
 * different sample rates. `sampleRate` is the working file's, and sets the Nyquist the
 * band weight is clamped to — it is a property of the *analysis*, not of the filter that
 * gets rendered from this curve.
 */
export function deriveToneCurve(
  working: FrequencySpectrum,
  reference: FrequencySpectrum,
  sampleRate: number,
  config: ToneMatchConfig,
): ToneCurve {
  const resolved = resolveConfig(config);
  const { maxBoostDb, maxCutDb, smoothingOctave, minSmoothingHz } = resolved;

  const binCount = working.magnitudesLinear.length;
  const freqs = working.frequencies;
  const nyquist = sampleRate / 2;

  logger.info('irDerivation', 'Deriving tone-match curve', {
    maxBoostDb,
    maxCutDb,
    smoothingOctave,
    minSmoothingHz,
    matchBandHz: [resolved.matchLowHz, resolved.matchHighHz],
    sampleRate,
    bins: binCount,
  });

  if (binCount < 4) {
    throw new Error(`Spectrum too small to derive an IR (${binCount} bins)`);
  }

  // Put both spectra on the working file's frequency grid, in dB. Comparing bin index
  // to bin index skews the frequency axis whenever the two takes' sample rates differ.
  const workingDb = toDb(working.magnitudesLinear, binCount);
  const referenceDb = resampleDb(reference, freqs, binCount);

  const workingSm = smoothLogBand(freqs, workingDb, binCount, smoothingOctave, minSmoothingHz);
  const referenceSm = smoothLogBand(freqs, referenceDb, binCount, smoothingOctave, minSmoothingHz);

  const correction = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) correction[i] = referenceSm[i] - workingSm[i];

  // Remove the overall level difference, weighting each octave equally rather than each
  // bin. Bins are linear in frequency, so an unweighted mean over 100 Hz - 8 kHz is
  // really a mean of the top octave and drags a spurious offset into the whole curve.
  const offsetDb = logWeightedMean(freqs, correction, binCount, resolved.levelBandHz);

  // Trust weighting: full correction only inside the match band, and only where both
  // takes carry signal rather than their own noise floor.
  const confWorking = confidenceOf(workingSm, binCount, resolved);
  const confReference = confidenceOf(referenceSm, binCount, resolved);
  const snrWorking = snrConfidence(working, freqs, binCount, resolved, 'working');
  const snrReference = snrConfidence(reference, freqs, binCount, resolved, 'reference');

  const curveDb = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    const weight =
      bandWeight(
        freqs[i],
        resolved.matchLowHz,
        resolved.matchHighHz,
        nyquist,
        resolved.taperOctaves,
      ) *
      Math.min(confWorking[i], confReference[i]) *
      Math.min(snrWorking[i], snrReference[i]);
    curveDb[i] = clamp((correction[i] - offsetDb) * weight, -maxCutDb, maxBoostDb);
  }

  let maxGainDb = 0;
  for (let i = 0; i < binCount; i++) {
    if (curveDb[i] > maxGainDb) maxGainDb = curveDb[i];
  }

  logger.info('irDerivation', 'Tone-match curve derived', {
    offsetDb: offsetDb.toFixed(2),
    maxGainDb: maxGainDb.toFixed(2),
    gainAt1kDb: interpolateAt(freqs, curveDb, binCount, 1000).toFixed(2),
  });

  return { frequencies: freqs, curveDb, maxGainDb, offsetDb };
}

/**
 * Render a tone curve as a minimum-phase FIR at a given rate and length.
 *
 * Minimum phase is what a hardware IR loader expects — using the program material's own
 * phase yields a smeared, unusable filter.
 *
 * `sampleRate` is free to differ from the rate the curve was derived at. That is the whole
 * point of the split: exporting at 48 kHz renders a fresh 48 kHz filter instead of
 * resampling a 44.1 kHz one. Extrapolation past the curve's own Nyquist is safe because
 * `bandWeight` has already driven the curve to 0 dB by then and `interpolateAt` holds the
 * last value flat, so the extra octave comes out as unity gain rather than as junk.
 */
export function renderToneMatchIR(
  curve: ToneCurve,
  sampleRate: number,
  taps: number,
): ImpulseResponse {
  const { frequencies: freqs, curveDb, maxGainDb } = curve;
  const binCount = curveDb.length;

  // Oversample the cepstrum FFT generously: a too-short cepstrum wraps the filter's own
  // tail back onto its head and quietly distorts the low end.
  const fftLen = Math.max(nextPowerOfTwo(taps * 8), 32768);
  const coefficients = minimumPhaseFromMagnitude(
    curveDb,
    freqs,
    binCount,
    fftLen,
    taps,
    sampleRate,
  );

  fadeOutTail(coefficients);

  const l1Norm = l1NormOf(coefficients);

  logger.info('irDerivation', 'Tone-match IR rendered', {
    taps: coefficients.length,
    sampleRate,
    maxGainDb: maxGainDb.toFixed(2),
    // The first sample of a minimum-phase filter routinely exceeds 1 — it is not a
    // clipping predictor, and rescaling the IR to force it under would throw away the
    // level match. Measured at up to -7 dB of unwanted attenuation when it did.
    // Output headroom is a playback concern, handled there via `l1Norm`.
    peak: peakOf(coefficients, coefficients.length).toFixed(3),
    l1Norm: l1Norm.toFixed(3),
    l1NormDb: (20 * Math.log10(Math.max(l1Norm, 1e-12))).toFixed(2),
  });

  return {
    coefficients,
    length: coefficients.length,
    sampleRate,
    maxGainDb,
    l1Norm,
  };
}

function toDb(magnitudes: Float32Array, binCount: number): Float32Array {
  const out = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    out[i] = 20 * Math.log10(Math.max(magnitudes[i], 1e-12));
  }
  return out;
}

/** `source` sampled onto `targetFreqs`, in dB. Handles a sample-rate mismatch between takes. */
function resampleDb(
  source: FrequencySpectrum,
  targetFreqs: Float32Array,
  targetCount: number,
): Float32Array {
  const sourceCount = source.magnitudesLinear.length;
  const sourceDb = toDb(source.magnitudesLinear, sourceCount);
  const out = new Float32Array(targetCount);
  for (let i = 0; i < targetCount; i++) {
    out[i] = interpolateAt(source.frequencies, sourceDb, sourceCount, targetFreqs[i]);
  }
  return out;
}

/**
 * Fractional-octave smoothing with an absolute bandwidth floor, run twice so the kernel
 * is triangular rather than a boxcar — a boxcar leaves visible ripple.
 */
function smoothLogBand(
  freqs: Float32Array,
  valuesDb: Float32Array,
  binCount: number,
  fraction: number,
  minWidthHz: number,
): Float32Array {
  // Two passes convolve to roughly the requested width when each is narrowed by √2.
  const passFraction = fraction / Math.SQRT2;
  const passMinWidth = minWidthHz / Math.SQRT2;
  let current = valuesDb;
  for (let pass = 0; pass < 2; pass++) {
    current = boxSmooth(freqs, current, binCount, passFraction, passMinWidth);
  }
  return current;
}

function boxSmooth(
  freqs: Float32Array,
  valuesDb: Float32Array,
  binCount: number,
  fraction: number,
  minWidthHz: number,
): Float32Array {
  const prefix = new Float64Array(binCount + 1);
  for (let i = 0; i < binCount; i++) prefix[i + 1] = prefix[i] + valuesDb[i];

  const spacing = freqs[1] || 1;
  const halfOctave = Math.pow(2, fraction / 2);
  const out = new Float32Array(binCount);

  for (let i = 0; i < binCount; i++) {
    const frequency = freqs[i];
    let lowHz = frequency / halfOctave;
    let highHz = frequency * halfOctave;
    if (highHz - lowHz < minWidthHz) {
      lowHz = frequency - minWidthHz / 2;
      highHz = frequency + minWidthHz / 2;
    }

    const lo = Math.max(0, Math.floor(lowHz / spacing));
    const hi = Math.min(binCount - 1, Math.ceil(highHz / spacing));
    const count = Math.max(1, hi - lo + 1);
    out[i] = (prefix[hi + 1] - prefix[lo]) / count;
  }

  return out;
}

/** Mean over a band with every octave weighted equally (bins are linear in frequency). */
function logWeightedMean(
  freqs: Float32Array,
  valuesDb: Float32Array,
  binCount: number,
  band: [number, number],
): number {
  const [lowHz, highHz] = band;
  let sum = 0;
  let weightSum = 0;
  for (let i = 0; i < binCount; i++) {
    const frequency = freqs[i];
    if (frequency <= 0 || frequency < lowHz || frequency > highHz) continue;
    const weight = 1 / frequency;
    sum += valuesDb[i] * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? sum / weightSum : 0;
}

/**
 * Confidence from each bin's distance above that take's own estimated noise floor,
 * resampled onto `targetFreqs`.
 *
 * This is the discriminator a level threshold cannot provide. Where the program has
 * rolled off, hiss *is* the measured spectrum — it can even be the loudest thing in the
 * band — so "how far below the peak is this bin" says nothing. "How far above this
 * recording's own floor" says everything.
 *
 * Two takes always have different floors, so their ratio up there is a difference of
 * noise, not of tone, and applying it boosts hiss by tens of dB.
 *
 * Guard: if even the loud bins sit close to the floor, the material is stationary enough
 * that minimum statistics cannot separate signal from noise (a pure noise source is the
 * degenerate case). The estimate is then meaningless rather than merely imprecise, so
 * this backs off to no gating and says so, leaving the match band as the only defence.
 */
function snrConfidence(
  spectrum: FrequencySpectrum,
  targetFreqs: Float32Array,
  targetCount: number,
  config: ResolvedToneMatchConfig,
  label: string,
): Float32Array {
  const ones = new Float32Array(targetCount).fill(1);
  const floor = spectrum.noiseFloorLinear;
  if (!floor) return ones;

  const sourceCount = Math.min(spectrum.magnitudesLinear.length, floor.length);
  const snrDb = new Float32Array(sourceCount);
  for (let i = 0; i < sourceCount; i++) {
    const signal = Math.max(spectrum.magnitudesLinear[i], 1e-12);
    const noise = Math.max(floor[i], 1e-12);
    snrDb[i] = 20 * Math.log10(signal / noise);
  }

  const smoothed = smoothLogBand(
    spectrum.frequencies,
    snrDb,
    sourceCount,
    config.smoothingOctave,
    config.minSmoothingHz,
  );

  const sorted = Array.from(smoothed).sort((a, b) => a - b);
  const upperQuartile = sorted[Math.floor(sorted.length * 0.75)];
  if (upperQuartile < config.minUsableSnrDb) {
    logger.warn(
      'irDerivation',
      `Noise-floor estimate unusable for ${label} — material too stationary, SNR gate disabled`,
      { upperQuartileSnrDb: upperQuartile.toFixed(1) },
    );
    return ones;
  }

  const span = config.snrFullDb - config.snrFloorDb;
  const confidence = new Float32Array(sourceCount);
  for (let i = 0; i < sourceCount; i++) {
    const t = clamp((smoothed[i] - config.snrFloorDb) / span, 0, 1);
    confidence[i] = t * t * (3 - 2 * t);
  }

  const out = new Float32Array(targetCount);
  for (let i = 0; i < targetCount; i++) {
    out[i] = interpolateAt(spectrum.frequencies, confidence, sourceCount, targetFreqs[i]);
  }
  return out;
}

/** 0 where a spectrum has no usable signal, 1 where it clearly does. */
function confidenceOf(
  smoothedDb: Float32Array,
  binCount: number,
  config: ResolvedToneMatchConfig,
): Float32Array {
  let peakDb = -Infinity;
  for (let i = 0; i < binCount; i++) {
    if (smoothedDb[i] > peakDb) peakDb = smoothedDb[i];
  }

  const span = config.fullRelDb - config.floorRelDb;
  const out = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    const t = clamp((smoothedDb[i] - peakDb - config.floorRelDb) / span, 0, 1);
    out[i] = t * t * (3 - 2 * t);
  }
  return out;
}

/**
 * 1 inside the match band, falling to 0 `taperOctaves` outside it.
 *
 * This is the main defence against the classic tone-match failure: outside the material's
 * useful bandwidth both takes are just their own (different) noise floors, so their ratio
 * is garbage and gets applied as tens of dB of hiss boost.
 */
function bandWeight(
  frequency: number,
  lowHz: number,
  highHz: number,
  nyquist: number,
  taperOctaves: number,
): number {
  if (frequency <= 0) return 0;

  const span = Math.pow(2, taperOctaves);
  const lowStop = lowHz / span;
  const highStop = Math.min(highHz * span, nyquist);
  const passHigh = Math.min(highHz, highStop);

  if (frequency <= lowStop || frequency >= highStop) return 0;
  if (frequency >= lowHz && frequency <= passHigh) return 1;

  const t =
    frequency < lowHz
      ? Math.log2(frequency / lowStop) / Math.log2(lowHz / lowStop)
      : Math.log2(highStop / frequency) / Math.log2(highStop / passHigh);

  return 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
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
    const lnMag = (interpolateAt(freqs, curveDb, binCount, frequency) / 20) * Math.LN10;
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

/** Linear interpolation into a uniformly spaced spectrum, held flat past both ends. */
function interpolateAt(
  freqs: Float32Array,
  values: Float32Array,
  count: number,
  frequency: number,
): number {
  const spacing = freqs[1] || 1;
  const position = frequency / spacing;

  if (position <= 0) return values[0];
  if (position >= count - 1) return values[count - 1];

  const index = Math.floor(position);
  const fraction = position - index;
  return values[index] + (values[index + 1] - values[index]) * fraction;
}

/**
 * Short half-Hann fade so truncation doesn't leave a step.
 *
 * Kept short on purpose: in a minimum-phase filter the tail is what resolves the low
 * end, so fading a large fraction of it costs bass accuracy.
 */
function fadeOutTail(ir: Float32Array): void {
  const fadeLength = Math.max(1, Math.min(128, ir.length >> 2));
  const start = ir.length - fadeLength;
  for (let i = 0; i < fadeLength; i++) {
    ir[start + i] *= 0.5 * (1 + Math.cos((Math.PI * i) / fadeLength));
  }
}

/**
 * Sum of |h[n]| — the filter's gain for the worst input it could ever be given.
 *
 * The maximising signal is `sign(h[-n])`, which drives every tap to add constructively at
 * one instant. Real music is not that signal, but a transient through a boosted band gets
 * close enough that trimming by `max|H(f)|` alone leaves audible clipping on hot material.
 */
function l1NormOf(values: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += Math.abs(values[i]);
  return sum;
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
