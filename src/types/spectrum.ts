export interface FrequencySpectrum {
  frequencies: Float32Array;
  magnitudesLinear: Float32Array;
  magnitudesDb: Float32Array;
  /**
   * Per-bin phase, present only for a single-frame `computeFFT`. Absent on anything
   * Welch-averaged: an averaged magnitude has no phase, and the previous zero-filled array
   * was indistinguishable from a genuine measurement of zero phase. The IR derives its own
   * phase from the magnitude instead (`minimumPhaseFromMagnitude`).
   */
  phase?: Float32Array;
  /**
   * Per-bin estimate of the recording's stationary noise floor, in the same linear
   * amplitude units as `magnitudesLinear`. Present only when the spectrum came from
   * enough frames to estimate it. See `estimateNoiseFloor` in fftProcessor.
   */
  noiseFloorLinear?: Float32Array;
}

export interface FFTConfig {
  fftSize: 512 | 1024 | 2048 | 4096 | 8192 | 16384;
  window: 'hann' | 'hamming' | 'rectangular';
  overlap: 0.5 | 0.75;
}

export interface FFTResult {
  magnitudes: Float32Array;
  /** Single-frame transforms only — see `FrequencySpectrum.phase`. */
  phases?: Float32Array;
  frequencies: Float32Array;
  noiseFloor?: Float32Array;
}
