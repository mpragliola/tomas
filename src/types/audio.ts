/** A is the working sound, B is the reference tone. */
export type SlotId = 'A' | 'B';

/**
 * What the transport is playing: A dry, A through the derived IR, or the reference
 * itself. A and B share a playhead so they can be swapped mid-listen; C has its own.
 */
export type PlaybackMode = 'original' | 'processed' | 'reference';

export interface WavHeader {
  sampleRate: number;
  channels: number;
  bitDepth: 16 | 24 | 32;
  duration: number;
}

export interface AudioBuffer {
  header: WavHeader;
  /**
   * Mono mixdown. What the waveform, transport and convolver read — the IR is mono, and
   * so is monitoring.
   */
  audioData: Float32Array;
  /**
   * The same take, deinterleaved, one entry per original channel.
   *
   * Analysis reads this rather than `audioData` because a coherent `(L+R)/2` cancels
   * inter-channel phase *before* the FFT, carving comb notches into the magnitude
   * spectrum. See `channelPower` in fftProcessor. Mono sources hold a single entry.
   */
  channels: Float32Array[];
}

export interface RecorderConfig {
  sampleRate: 44100 | 48000;
  maxDuration: number;
  /**
   * Mono only. Everything downstream — FFT, IR derivation, the waveform peaks — is
   * single-channel, and a stereo take would have to be collapsed anyway; doing it here
   * keeps the collapse explicit instead of leaving it to a node's default mixing.
   */
  channelCount: 1;
  /**
   * Which channel of a multi-channel input to keep, 0-based. Picked, not summed: a mic on
   * one input of a stereo interface is the normal case, and summing it with the silent
   * other input costs 6 dB.
   */
  channelIndex: number;
  autoThreshold: number;
  /** When false (default) recording runs until stopped, ignoring autoThreshold. */
  autoTrigger?: boolean;
  deviceId?: string;
}

export interface RecorderState {
  isRecording: boolean;
  /**
   * Auto-trigger is on and the take is still waiting for the signal to cross the
   * threshold — the stream is open and metering, but nothing is being kept yet.
   */
  isArmed: boolean;
  isPaused: boolean;
  recordedDuration: number;
  level: number;
  /** Channels the device actually handed over; only the picked one is kept. */
  inputChannels: number;
  /** The channel being kept, 0-based — the requested one unless the device has fewer. */
  channelIndex: number;
}
