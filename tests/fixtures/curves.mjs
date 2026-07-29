/**
 * Frequency-response curves shared by the fixture generator and the tests.
 *
 * The generator bakes these into the WAV fixtures; the tests use them to compute the
 * answer a correct tone match is supposed to produce. Same source, so the two can never
 * drift apart.
 */

/** A shelf, a dip and a bass rolloff — smooth enough for 1/6-octave to resolve. */
export function targetCurveDb(frequency) {
  if (frequency <= 0) return 0;
  const f = Math.max(frequency, 1);
  return (
    6 / (1 + Math.pow(3000 / f, 2)) -
    5 * Math.exp(-Math.pow(Math.log2(f / 400), 2) / (2 * 0.35 * 0.35)) -
    8 / (1 + Math.pow(f / 80, 4))
  );
}

/**
 * Guitar-cab-like band limiting: dead below ~90 Hz and above the top knee.
 *
 * `topKneeHz` moves the upper rolloff. The mixed-program fixtures use a higher knee than
 * the cab-noise ones so that their material still clears their own noise floor at 6 kHz —
 * below that the SNR gate decides its floor estimate is unusable and switches itself off,
 * and a fixture that trips that is testing the disabled path, not the gate.
 */
export function cabCurveDb(frequency, topKneeHz = 5000) {
  if (frequency <= 0) return -80;
  return (
    -20 * Math.log10(Math.sqrt(1 + Math.pow(frequency / topKneeHz, 12))) +
    20 * Math.log10(Math.pow(frequency / 90, 2) / Math.sqrt(1 + Math.pow(frequency / 90, 4)))
  );
}
