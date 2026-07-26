export interface WavHeader {
  sampleRate: number;
  channels: number;
  bitDepth: 16 | 24 | 32;
  duration: number;
}

export interface AudioBuffer {
  header: WavHeader;
  audioData: Float32Array;
}

export interface RecorderConfig {
  sampleRate: 44100 | 48000;
  maxDuration: number;
  channelCount: 1 | 2;
  autoThreshold: number;
}

export interface RecorderState {
  isRecording: boolean;
  isPaused: boolean;
  recordedDuration: number;
  level: number;
}
