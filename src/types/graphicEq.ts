/**
 * The 9-band graphic EQ: a hand-editable correction layered on top of the tone-match
 * curve. It never touches the derivation (`deriveToneCurve` reads only the two spectra),
 * and it never sounds different from the tone-match-only curve until `enabled` is true —
 * see `applyGraphicEq` in `services/dsp/graphicEqResponse.ts`, which is where the two
 * curves actually combine.
 */

/** 1:1 with the native `BiquadFilterType` values this app supports exposing per band. */
export type GraphicEqBandType =
  | 'peaking'
  | 'lowshelf'
  | 'highshelf'
  | 'lowpass'
  | 'highpass'
  | 'notch';

export interface GraphicEqBand {
  /** Stable across edits — `band-${frequency}` from the fixed default ladder. */
  id: string;
  frequency: number;
  /**
   * dB. Meaningless for `lowpass`/`highpass`/`notch` — those types have no gain in the
   * RBJ cookbook formulas they're built from, matching native `BiquadFilterNode` — but
   * kept here (rather than dropped) so switching a band back to `peaking` restores
   * whatever the user last dialed in instead of resetting to 0.
   */
  gain: number;
  q: number;
  type: GraphicEqBandType;
  /** Bypassed bands contribute exactly 0 dB — see `graphicEqResponseDb`. */
  enabled: boolean;
}

export interface GraphicEqState {
  /** Master switch. Off means the whole subsystem is excluded from the rendered IR. */
  enabled: boolean;
  bands: GraphicEqBand[];
}

/**
 * Classic 1-octave-spaced graphic-EQ ladder — the same nine points as the familiar
 * 10-band hardware/software EQ, minus the 31 Hz sub band.
 */
export const GRAPHIC_EQ_FREQUENCIES: readonly number[] = [
  62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
];

/** ~1.41 — RBJ 1-octave peaking bandwidth, a sensible default for octave-spaced bands. */
export const DEFAULT_BAND_Q = Math.SQRT2;

export const GRAPHIC_EQ_GAIN_RANGE_DB: [number, number] = [-15, 15];
export const GRAPHIC_EQ_Q_RANGE: [number, number] = [0.1, 15];

export function createDefaultGraphicEqState(): GraphicEqState {
  return {
    enabled: false,
    bands: GRAPHIC_EQ_FREQUENCIES.map((frequency) => ({
      id: `band-${frequency}`,
      frequency,
      gain: 0,
      q: DEFAULT_BAND_Q,
      type: 'peaking',
      enabled: false,
    })),
  };
}
