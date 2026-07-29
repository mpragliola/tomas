import type { FrequencySpectrum, FFTResult } from '../../types/spectrum';
import { logger } from '../logging';

export function extractSpectrum(
  fftResult: FFTResult,
  refLevel: number = 1.0,
): FrequencySpectrum {
  logger.debug('spectrum', 'Extracting spectrum', { refLevel });

  const { magnitudes, phases, frequencies, noiseFloor } = fftResult;
  const magnitudesDb = new Float32Array(magnitudes.length);

  let maxDb = -Infinity;
  let minDb = Infinity;
  for (let i = 0; i < magnitudes.length; i++) {
    // Avoid log(0) — clamp to small value
    const clampedMag = Math.max(magnitudes[i], 1e-10);
    const db = 20 * Math.log10(clampedMag / refLevel);
    magnitudesDb[i] = db;
    if (db > maxDb) maxDb = db;
    if (db < minDb) minDb = db;
  }

  const spectrum: FrequencySpectrum = {
    frequencies,
    magnitudesLinear: magnitudes,
    magnitudesDb,
    phase: phases,
    noiseFloorLinear: noiseFloor,
  };

  logger.debug('spectrum', 'Spectrum extracted', {
    bins: magnitudes.length,
    maxDb,
    minDb,
    hasNoiseFloor: noiseFloor !== undefined,
  });

  return spectrum;
}
