import type { ImpulseResponse, IRDerivationConfig } from '../../types/ir';
import type { FrequencySpectrum } from '../../types/spectrum';

export function deriveIR(
  spectrumA: FrequencySpectrum,
  spectrumB: FrequencySpectrum,
  config: IRDerivationConfig
): ImpulseResponse {
  throw new Error('Not implemented');
}
