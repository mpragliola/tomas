import type { FFTConfig } from '../../types/spectrum';
import { TONE_MATCH_DEFAULTS } from './irDerivation';
import type { ToneMatchConfig } from './irDerivation';

/**
 * Analysis defaults for tone matching.
 *
 * 16384 rather than 2048: at 44.1 kHz a 2048-point FFT gives 21.5 Hz bins, and a
 * 1/6-octave band at 100 Hz is only 12 Hz wide — narrower than one bin — so the whole
 * low end arrives unsmoothed and noisy. Measured end-to-end error against a known target
 * curve drops from 0.66 dB to 0.06 dB at 16384. The cost is milliseconds, offline.
 *
 * 0.75 overlap gives roughly twice the frames for the same take, so the Welch average
 * settles faster on short selections.
 */
export const DEFAULT_FFT_CONFIG: FFTConfig = {
  fftSize: 16384,
  window: 'hann',
  overlap: 0.75,
};

export const DEFAULT_TONE_MATCH_CONFIG: ToneMatchConfig = {
  taps: 2048,
  ...TONE_MATCH_DEFAULTS,
};

/**
 * Exponential smoothing between analyser frames. Raw frames flicker several dB per
 * bin on music; 0.7 settles that without visibly trailing the transients.
 */
export const LIVE_ANALYSER_SMOOTHING = 0.7;

/**
 * Level correction from the analyser's dBFS to the offline spectra's dB, so the moving
 * curve overlays the static ones instead of sitting 7 dB below them.
 *
 * Both measure the same signal but normalize differently: `computeAveragedFFT` divides
 * by fftSize/2 and windows with Hann (coherent gain 0.5), while the Web Audio analyser
 * divides by fftSize and windows with Blackman (coherent gain 0.42). The ratio is
 * 0.5 / (0.42 / 2) = 2.38, i.e. 20*log10(2.38) dB.
 */
export const LIVE_ANALYSER_DB_OFFSET = 7.5;

/**
 * Shortest selection that produces a trustworthy averaged spectrum. Below roughly this
 * much material the Welch average is a handful of frames of one transient, and the
 * resulting "IR" is noise — measured at ±17 dB of pure garbage for a 200-sample selection.
 */
export const MIN_ANALYSIS_SECONDS = 1;
