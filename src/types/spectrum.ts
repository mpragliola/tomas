export interface FrequencySpectrum {
  frequencies: Float32Array;
  magnitudesLinear: Float32Array;
  magnitudesDb: Float32Array;
  phase: Float32Array;
}

export interface FFTConfig {
  fftSize: 512 | 1024 | 2048 | 4096 | 8192 | 16384;
  window: 'hann' | 'hamming' | 'rectangular';
  overlap: 0.5 | 0.75;
}

export interface FFTResult {
  magnitudes: Float32Array;
  phases: Float32Array;
  frequencies: Float32Array;
}
