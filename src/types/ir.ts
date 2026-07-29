export interface ImpulseResponse {
  coefficients: Float32Array;
  length: number;
  sampleRate: number;
  /**
   * Largest boost anywhere in the filter's response, in dB. Reported for display; the
   * playback trim uses `l1Norm`, which is the bound that actually holds.
   */
  maxGainDb?: number;
  /**
   * Sum of |h[n]| — the filter's worst-case time-domain gain, and the only trim that
   * cannot clip. `max|H(f)|` bounds a steady sine and nothing else: a transient excites
   * every band at once, so its peak gain is the L1 norm, routinely 3-10 dB above the
   * largest boost even for a smooth minimum-phase EQ.
   */
  l1Norm?: number;
}

/**
 * The tone correction as a frequency curve, before it becomes a filter.
 *
 * Kept separate from the rendered `ImpulseResponse` because the curve is what the analysis
 * actually produced: it has no sample rate and no tap count of its own. Rendering at a
 * given rate and length is a second, cheap step, so exporting at 48 kHz means rendering a
 * fresh minimum-phase FIR at 48 kHz rather than resampling a 44.1 kHz one — resampling an
 * impulse response is what puts several dB of error into the top octave.
 */
export interface ToneCurve {
  /** Bin centre frequencies the curve is defined on, from the working take's grid. */
  frequencies: Float32Array;
  /** Filter gain in dB at each of those frequencies. 0 dB means "leave it alone". */
  curveDb: Float32Array;
  /** Largest boost in the curve, in dB. */
  maxGainDb: number;
  /** Level difference removed before weighting, in dB. Reported for logging only. */
  offsetDb: number;
}
