import type { FrequencySpectrum } from './spectrum';

export interface ImpulseResponse {
  coefficients: Float32Array;
  length: number;
  sampleRate: number;
}

export interface IRDerivationConfig {
  method: 'difference' | 'ratio';
  phase: 'preserve-B' | 'minimum-phase';
  maxLength: number;
  truncationDb: number;
}

export type IRDerivationInput = {
  spectrumA: FrequencySpectrum;
  spectrumB: FrequencySpectrum;
  config: IRDerivationConfig;
};
