import FFT from 'fft.js';
import type { ImpulseResponse } from '../../types/ir';

export interface IrMagnitudeResponse {
  /** Bin centre frequencies in Hz, starting at the first bin above DC. */
  frequencies: Float32Array;
  /** |H(f)| in dB. This is filter gain, so 0 dB means "leaves the signal alone". */
  magnitudesDb: Float32Array;
  /** Largest absolute deviation from 0 dB — a ready-made symmetric plot range. */
  maxAbsDb: number;
}

/**
 * Magnitude response of a derived IR, for display alongside the spectra it came from.
 *
 * DC is dropped: it is meaningless for a tone curve and a zero frequency cannot be
 * plotted on the log axis the spectra use.
 */
export function irMagnitudeResponse(
  ir: ImpulseResponse,
  fftLen: number = 8192,
): IrMagnitudeResponse {
  const taps = ir.coefficients;
  // The IR must fit with room to spare, or truncation shows up as ripple in the response.
  const size = Math.max(fftLen, nextPowerOfTwo(taps.length * 2));
  const half = size / 2;

  const fft = new FFT(size);
  const input = new Array<number>(size).fill(0);
  for (let i = 0; i < taps.length; i++) input[i] = taps[i];

  const spectrum = fft.createComplexArray();
  fft.realTransform(spectrum, input);

  // Bins 1..half-1: DC is dropped as above, Nyquist adds nothing at this display scale.
  const frequencies = new Float32Array(half - 1);
  const magnitudesDb = new Float32Array(half - 1);
  let maxAbsDb = 0;

  for (let k = 1; k < half; k++) {
    const re = spectrum[k * 2];
    const im = spectrum[k * 2 + 1];
    const magnitude = Math.max(Math.hypot(re, im), 1e-9);
    const db = 20 * Math.log10(magnitude);

    frequencies[k - 1] = (k * ir.sampleRate) / size;
    magnitudesDb[k - 1] = db;
    if (Math.abs(db) > maxAbsDb) maxAbsDb = Math.abs(db);
  }

  return { frequencies, magnitudesDb, maxAbsDb };
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}
