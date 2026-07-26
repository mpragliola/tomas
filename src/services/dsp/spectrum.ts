import type { FrequencySpectrum, FFTResult } from '../../types/spectrum';

export function extractSpectrum(
  fftResult: FFTResult,
  refLevel: number = 1.0
): FrequencySpectrum {
  throw new Error('Not implemented');
}
