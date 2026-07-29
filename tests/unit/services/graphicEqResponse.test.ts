import { describe, it, expect } from 'vitest';
import {
  bandResponseDb,
  graphicEqResponseDb,
  applyGraphicEq,
} from '../../../src/services/dsp/graphicEqResponse';
import { createDefaultGraphicEqState } from '../../../src/types/graphicEq';
import type { GraphicEqBand } from '../../../src/types/graphicEq';
import type { ToneCurve } from '../../../src/types/ir';

const SAMPLE_RATE = 48000;

function band(partial: Partial<GraphicEqBand>): GraphicEqBand {
  return {
    id: 'band-1000',
    frequency: 1000,
    gain: 0,
    q: Math.SQRT2,
    type: 'peaking',
    enabled: true,
    ...partial,
  };
}

function curveOf(frequencies: number[], curveDb: number[]): ToneCurve {
  return {
    frequencies: new Float32Array(frequencies),
    curveDb: new Float32Array(curveDb),
    maxGainDb: Math.max(0, ...curveDb),
    offsetDb: 0,
  };
}

describe('graphicEqResponseDb', () => {
  it('is exactly 0 dB everywhere when every band is disabled', () => {
    const state = createDefaultGraphicEqState();
    const frequencies = new Float32Array([50, 200, 1000, 5000, 15000]);
    const response = graphicEqResponseDb(state.bands, frequencies, SAMPLE_RATE);

    for (let i = 0; i < response.length; i++) expect(response[i]).toBe(0);
  });

  it('excludes disabled bands even when the master would otherwise include them', () => {
    const bands = [
      band({ frequency: 1000, gain: 6, enabled: false }),
      band({ id: 'band-4000', frequency: 4000, gain: 6, enabled: true }),
    ];
    const frequencies = new Float32Array([1000]);
    const response = graphicEqResponseDb(bands, frequencies, SAMPLE_RATE);

    // Only the 4kHz band is enabled, and it contributes ~nothing at 1kHz — the
    // disabled 1kHz band's own gain must not leak in.
    expect(Math.abs(response[0])).toBeLessThan(1);
  });

  it('reports a peaking band\'s own gain at its centre frequency', () => {
    for (const gain of [-9, -3, 3, 9]) {
      const response = bandResponseDb(band({ gain }), new Float32Array([1000]), SAMPLE_RATE);
      expect(response[0]).toBeCloseTo(gain, 2);
    }
  });

  it('sums two peaking bands in dB (cascaded gain, not averaged)', () => {
    const bands = [
      band({ id: 'a', frequency: 1000, gain: 4, q: 8 }),
      band({ id: 'b', frequency: 1000, gain: 3, q: 8 }),
    ];
    const response = graphicEqResponseDb(bands, new Float32Array([1000]), SAMPLE_RATE);
    expect(response[0]).toBeCloseTo(7, 1);
  });

  it('puts a lowpass/highpass at -3dB at its own cutoff when Q is Butterworth (0.707)', () => {
    const lp = bandResponseDb(
      band({ type: 'lowpass', q: Math.SQRT1_2 }),
      new Float32Array([1000]),
      SAMPLE_RATE,
    );
    expect(lp[0]).toBeCloseTo(-3.01, 1);

    const hp = bandResponseDb(
      band({ type: 'highpass', q: Math.SQRT1_2 }),
      new Float32Array([1000]),
      SAMPLE_RATE,
    );
    expect(hp[0]).toBeCloseTo(-3.01, 1);
  });

  it('drops toward -infinity at the centre of a notch', () => {
    const response = bandResponseDb(band({ type: 'notch' }), new Float32Array([1000]), SAMPLE_RATE);
    expect(response[0]).toBeLessThan(-40);
  });
});

describe('applyGraphicEq', () => {
  it('is a no-op when the master toggle is off', () => {
    const curve = curveOf([100, 1000, 10000], [1, -2, 3]);
    const state = createDefaultGraphicEqState();
    state.bands[4].gain = 6;
    state.bands[4].enabled = true; // would matter if enabled were true — it is not

    const result = applyGraphicEq(curve, state, SAMPLE_RATE);
    expect(result).toBe(curve);
  });

  it('adds the graphic EQ response onto the tone-match curve in dB, leaving frequencies untouched', () => {
    const curve = curveOf([1000], [2]);
    const state = createDefaultGraphicEqState();
    state.enabled = true;
    const bandAt1k = state.bands.find((b) => b.frequency === 1000)!;
    bandAt1k.enabled = true;
    bandAt1k.gain = 5;

    const result = applyGraphicEq(curve, state, SAMPLE_RATE);
    expect(result.frequencies).toBe(curve.frequencies);
    expect(result.curveDb[0]).toBeCloseTo(7, 1);
    expect(result.maxGainDb).toBeCloseTo(7, 1);
  });
});
