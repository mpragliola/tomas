import { describe, it, expect } from 'vitest';
import { AudioRecorder } from '../../../src/services/audio/recorder';

const BLOCK = 4096;

/** Steady tone-like block whose peak and RMS are both `db`. */
function steady(db: number): Float32Array {
  const amp = Math.pow(10, db / 20);
  const c = new Float32Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) c[i] = i % 2 ? amp : -amp;
  return c;
}

/**
 * A clap: a short burst inside an otherwise silent block. Peaks at `db`, but its RMS over
 * the whole 93 ms block lands ~24 dB lower — the case the old RMS-based trigger missed.
 */
function transient(db: number, burst = 16): Float32Array {
  const amp = Math.pow(10, db / 20);
  const c = new Float32Array(BLOCK);
  for (let i = 0; i < burst; i++) c[i] = i % 2 ? amp : -amp;
  return c;
}

function armedRecorder(autoThreshold = -40): any {
  const rec: any = new AudioRecorder();
  rec.config = {
    sampleRate: 44100,
    maxDuration: 20000,
    channelCount: 1,
    channelIndex: 0,
    autoThreshold,
    autoTrigger: true,
  };
  rec.isRecording = true;
  rec.isActive = true;
  rec.silenceStart = Date.now();
  return rec;
}

function feed(rec: any, chunk: Float32Array): void {
  rec.processAudio({ inputBuffer: { getChannelData: () => chunk } });
}

describe('AudioRecorder auto-trigger', () => {
  it('holds capture while the input stays under the threshold', () => {
    const rec = armedRecorder();
    feed(rec, steady(-55));
    expect(rec.getState().isArmed).toBe(true);
    expect(rec.recordedChunks.length).toBe(0);
  });

  it('fires on a transient whose peak crosses the threshold', () => {
    const rec = armedRecorder(-40);
    const clap = transient(-20);
    // The block this trigger has to survive: peak well over the threshold, RMS well under it
    const rms = Math.sqrt(clap.reduce((s, v) => s + v * v, 0) / BLOCK);
    expect(20 * Math.log10(rms)).toBeLessThan(-40);

    feed(rec, clap);
    expect(rec.getState().isArmed).toBe(false);
    expect(rec.recordedChunks.length).toBe(1);
  });

  it('keeps the block that crossed, so the attack is not clipped off the take', () => {
    const rec = armedRecorder();
    const clap = transient(-15);
    feed(rec, clap);
    expect(rec.recordedChunks[0][0]).toBeCloseTo(clap[0], 6);
  });

  it('does not arm-gate a manual take', () => {
    const rec = armedRecorder();
    rec.config.autoTrigger = false;
    feed(rec, steady(-70));
    expect(rec.getState().isArmed).toBe(false);
    expect(rec.recordedChunks.length).toBe(1);
  });
});
