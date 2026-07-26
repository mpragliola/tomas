import type { FrequencySpectrum, FFTResult } from '../../types/spectrum';
import { logger } from '../logging';

export function extractSpectrum(
  fftResult: FFTResult,
  refLevel: number = 1.0,
): FrequencySpectrum {
  logger.debug('spectrum', 'Extracting spectrum', { refLevel });

  const { magnitudes, phases, frequencies } = fftResult;
  const magnitudesDb = new Float32Array(magnitudes.length);

  for (let i = 0; i < magnitudes.length; i++) {
    const mag = magnitudes[i];
    // Avoid log(0) — clamp to small value
    const clampedMag = Math.max(mag, 1e-10);
    magnitudesDb[i] = 20 * Math.log10(clampedMag / refLevel);
  }

  const spectrum: FrequencySpectrum = {
    frequencies,
    magnitudesLinear: magnitudes,
    magnitudesDb,
    phase: phases,
  };

  logger.debug('spectrum', 'Spectrum extracted', {
    bins: magnitudes.length,
    maxDb: Math.max(...magnitudesDb),
    minDb: Math.min(...magnitudesDb),
  });

  return spectrum;
}
