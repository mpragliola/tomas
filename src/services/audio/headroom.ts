import { convolveAudio } from './convolution';
import { logger } from '../logging';

/**
 * Headroom is measured on the loudest window of this length rather than on the whole take.
 * A 3-minute file costs 415 ms per channel to convolve offline and the IR is re-derived on
 * every selection drag; 10 s costs about 50 ms and still contains the peak that matters,
 * because the window is picked by energy rather than taken from the head of the file.
 */
export const PEAK_SCAN_SECONDS = 10;

/** Block length the energy scan works in, in seconds. */
const PEAK_BLOCK_SECONDS = 0.1;

/** How far below full scale a trimmed peak is parked, in dB. */
const PEAK_MARGIN_DB = 1;

export interface HeadroomMeasurement {
  /** Linear gain to apply so the filtered signal cannot clip. 1 when no trim is needed. */
  trim: number;
  /** Largest sample magnitude the filtered signal reached. */
  peak: number;
  /** Samples per channel that were actually convolved. */
  scanned: number;
}

/**
 * How much level this take has to give up to survive this filter, measured rather than bounded.
 *
 * Both closed-form bounds are far too pessimistic to listen through. `sum|h[n]|` is the gain
 * for `sign(h[-n])`, a sign-matched impulse train that no recording contains — it asks for
 * 10.6 dB on a ±6 dB curve. `max|H(f)|` is the steady-sine bound and errs the other way on
 * transients. The convolution answers the actual question, and on real material it usually
 * asks for no trim at all.
 */
export function measureHeadroomTrim(
  coefficients: Float32Array,
  channels: Float32Array[],
  sampleRate: number,
): HeadroomMeasurement {
  const windowLength = Math.max(1, Math.round(sampleRate * PEAK_SCAN_SECONDS));
  const blockSize = Math.max(1, Math.round(sampleRate * PEAK_BLOCK_SECONDS));

  let peak = 0;
  let scanned = 0;

  for (const channel of channels) {
    if (channel.length === 0) continue;
    const window = loudestWindow(channel, windowLength, blockSize);
    scanned = Math.max(scanned, window.length);

    const wet = convolveAudio({
      irCoefficients: coefficients,
      audioData: window,
      sampleRate,
    });

    for (let i = 0; i < wet.length; i++) {
      const magnitude = Math.abs(wet[i]);
      if (magnitude > peak) peak = magnitude;
    }
  }

  const ceiling = Math.pow(10, -PEAK_MARGIN_DB / 20);
  const trim = peak > ceiling ? ceiling / peak : 1;

  logger.debug('headroom', 'Headroom measured', { peak, trim, scanned });

  return { trim, peak, scanned };
}

/**
 * The `length`-sample stretch carrying the most energy.
 *
 * Peak headroom is a property of the loudest passage, and the head of a file is routinely
 * a count-in, a breath or silence — scanning from sample zero would measure the wrong part
 * of the take and let the chorus clip.
 */
export function loudestWindow(
  signal: Float32Array,
  length: number,
  blockSize: number,
): Float32Array {
  if (signal.length <= length) return signal;

  const blocks = Math.ceil(signal.length / blockSize);
  const energy = new Float64Array(blocks);
  for (let i = 0; i < signal.length; i++) {
    energy[(i / blockSize) | 0] += signal[i] * signal[i];
  }

  const span = Math.max(1, Math.min(blocks, Math.round(length / blockSize)));
  let running = 0;
  for (let b = 0; b < span; b++) running += energy[b];

  let best = running;
  let bestBlock = 0;
  for (let b = span; b < blocks; b++) {
    running += energy[b] - energy[b - span];
    if (running > best) {
      best = running;
      bestBlock = b - span + 1;
    }
  }

  const start = Math.max(0, Math.min(bestBlock * blockSize, signal.length - length));
  return signal.subarray(start, start + length);
}
