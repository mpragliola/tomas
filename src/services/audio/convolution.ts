export interface PlaybackConfig {
  irCoefficients: Float32Array;
  audioData: Float32Array;
  sampleRate: number;
}

export function convolveAudio(config: PlaybackConfig): Float32Array {
  throw new Error('Not implemented');
}
