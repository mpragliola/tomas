import type { FrequencySpectrum } from './spectrum';
import type { ImpulseResponse, ToneCurve } from './ir';
import type { GraphicEqState } from './graphicEq';
import type { ToneMatchConfig } from '../services/dsp/irDerivation';

/**
 * Which take a recording or a source-resolving helper is being asked about: A (the
 * working sound), or a specific reference tab's asset. B used to be *the* reference
 * tone, back when there was only one — the analysis store now supports up to
 * `MAX_REFERENCES` reference tabs (`ReferenceState`), so `'B'` no longer names anything
 * the store or app understands.
 *
 * Recording used to target A only; that restriction has been reversed for reference
 * tabs (any tab, empty or not, can be filled by a live take), so this is exported here
 * rather than kept store-internal — both the store's `recordingTarget`/`recordAudio`
 * and `.vue` components (`RecordingPanel`, `ReferenceSlot`) need the identical shape.
 */
export type RecordTarget = 'A' | { referenceId: string };

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

/**
 * A decoded reference file, kept independent of any tab that plays it back.
 *
 * `buffer` collapses what used to be two parallel copies (`audioBuffers`/`sourceBuffers`)
 * for a slot — every write site set both to the same value, so there was never a second
 * copy to keep. One `AudioAsset` can be pointed at by several `ReferenceState`s at once
 * (a clone shares the decoded audio, not the computed tone match), so it is deduped here
 * rather than living inside the tab.
 */
export interface AudioAsset {
  id: string;
  /** Mono mixdown — what the waveform and transport read. */
  buffer: Float32Array;
  /** The same take, deinterleaved. Analysis reads this; see `AudioBuffer.channels`. */
  channels: Float32Array[];
  sampleRate: number;
  header: WavHeader | null;
  sourceName: string;
}

export interface ReferenceSelection {
  startSample: number;
  endSample: number;
  duration: number;
}

/**
 * One reference tab: a loop/selection into an `AudioAsset`, plus everything derived
 * from comparing that selection against the working take (A) — its own spectrum, tone
 * curve, rendered IR and graphic EQ. Two tabs sharing an `assetId` (a clone) never share
 * any of that derived state, even if their selections happen to match.
 */
export interface ReferenceState {
  id: string;
  /** -> `audioAssets[assetId]`. Shared across clones of the same file. Null for a tab
   * created empty (via "+") that hasn't been filled in yet by a file load or a take. */
  assetId: string | null;
  selection: ReferenceSelection;
  spectrum: FrequencySpectrum | null;
  ir: ImpulseResponse | null;
  /**
   * The correction as a frequency curve, kept so the filter can be re-rendered at any
   * rate or tap count without re-analysing the audio. See `ToneCurve` for why this,
   * not `ir`, is what the analysis actually produced.
   */
  toneCurve: ToneCurve | null;
  graphicEq: GraphicEqState;
  toneMatchConfig: ToneMatchConfig;
  /** Where the transport is on this tab's own timeline, in seconds — null when idle. */
  playhead: number | null;
  /** `sourceName`, disambiguated ("kick.wav (2)") on collision with another tab. */
  label: string;
  /** True when A's spectrum or this tab's own selection/config changed since last compute. */
  stale: boolean;
}
