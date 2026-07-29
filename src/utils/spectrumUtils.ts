import type { FrequencySpectrum } from '../types/spectrum';

const MAGNITUDE_HEADROOM_DB = 6;
const MAGNITUDE_SPAN_DB = 90;
const MIN_PLOT_FREQ = 20;

/** Nyquist for a spectrum — its bins run to there, so the last one is the top. */
export function lastFrequency(values: Float32Array | null | undefined): number {
  return values && values.length > 0 ? values[values.length - 1] : 0;
}

/**
 * Loudest bin that is actually on screen. DC and the rumble below 20 Hz routinely carry
 * the largest magnitude in a take, and letting them set the top of the axis pushes
 * everything audible into the bottom half of a plot they are not even drawn on.
 */
export function peakDb(
  values: Float32Array | null | undefined,
  frequencies?: Float32Array | null
): number {
  let peak = -Infinity;
  if (!values) return peak;
  for (let i = 0; i < values.length; i++) {
    if (frequencies && frequencies[i] < MIN_PLOT_FREQ) continue;
    if (Number.isFinite(values[i]) && values[i] > peak) peak = values[i];
  }
  return peak;
}

/**
 * A y-range that does not move while audio plays.
 *
 * Anchored on the static spectra whenever there are any — those are the reference the
 * live curve is being compared against, and they do not change during a take. The live
 * frame is only the fallback for playing with nothing computed yet, and even then it is
 * read once per rebuild, not per frame.
 */
export function fixedMagnitudeRange(
  a: FrequencySpectrum | null,
  b: FrequencySpectrum | null,
  live: Float32Array | null
): [number, number] | null {
  const staticPeak = Math.max(
    peakDb(a?.magnitudesDb, a?.frequencies),
    peakDb(b?.magnitudesDb, b?.frequencies)
  );
  const peak = Number.isFinite(staticPeak) ? staticPeak : peakDb(live);

  if (!Number.isFinite(peak)) return null;

  // Snapped to 10 dB, so recomputing after a selection drag lands on the same axis
  // instead of nudging every gridline by a decibel
  const top = Math.ceil(peak / 10) * 10 + MAGNITUDE_HEADROOM_DB;
  return [top - MAGNITUDE_SPAN_DB, top];
}
