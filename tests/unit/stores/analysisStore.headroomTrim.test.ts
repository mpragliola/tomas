import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAnalysisStore } from '../../../src/stores/analysisStore';
import { setActivePinia, createPinia } from 'pinia';
import { toneFile } from '../../fixtures';
import { measureHeadroomTrim } from '../../../src/services/audio/headroom';

/**
 * Store-level coverage for the playback-path headroom trim (`headroomTrim()`,
 * `measureTrim()`, `gainFor()`, the `trimCache` invalidation around
 * `analysisStore.ts` lines ~842-869/991-1007). Only the underlying pure function
 * (`measureHeadroomTrim`, see `tests/unit/services/headroom.test.ts`) had coverage before
 * this file — the store's own wiring (which IR/audio it measures, how it's cached, how it
 * turns into the gain node's value) did not.
 *
 * `headroomTrim`/`gainFor`/`trimCache` are module-private — not exported — so this only
 * has the public surface to work with: `store.playback(...)` and `store.setVolume(...)`.
 * `playback()` unconditionally calls `ensureContext()`, which does
 * `new (window.AudioContext || ...)`, and this suite runs in Vitest's `node` environment
 * (see `vitest.config.ts`) where `window` does not exist at all — so without a stub,
 * `playback()` throws a `ReferenceError` before a single sample is touched, and the
 * headroom-trim code is never reached.
 *
 * To get past that without pulling in a heavyweight Web Audio mock, this file stubs the
 * minimum surface `playback()` actually calls on `AudioContext`/its nodes. Doing so has a
 * real payoff: because `createGain()` returns an object *this test itself* constructed and
 * kept a reference to, `gainNode.gain.value` — otherwise unreachable, since the store's
 * `gainNode` variable is a module-private `let` — is directly readable here. That is enough
 * to check `gainFor(volume) = volume^2 * trim` end-to-end against an independently computed
 * `measureHeadroomTrim` call, not just "did it throw".
 */

class FakeGainParam {
  value = 0;
  setTargetAtTime(): void {
    // Real WebAudio ramps the value over time; nothing here reads it mid-ramp, so a no-op
    // stand-in is sufficient — `gain.value` at creation time is what's under test.
  }
}

class FakeAudioNode {
  connect(): void {}
  disconnect(): void {}
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeGainParam();
}

class FakeBufferSourceNode extends FakeAudioNode {
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}

class FakeConvolverNode extends FakeAudioNode {
  normalize = true;
  buffer: unknown = null;
}

class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 2048;
  smoothingTimeConstant = 0;
}

/** Every `GainNode` this fake context has minted, in creation order — the test's only
 * window onto the value `playback()` computed via `gainFor()`. */
let createdGainNodes: FakeGainNode[] = [];

class FakeAudioContext {
  sampleRate: number;
  state = 'running';
  currentTime = 0;
  destination = new FakeAudioNode();

  constructor(options: { sampleRate: number }) {
    this.sampleRate = options.sampleRate;
  }

  createBuffer(numberOfChannels: number, length: number) {
    const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    return { getChannelData: (ch: number) => channels[ch] };
  }

  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    createdGainNodes.push(node);
    return node;
  }

  createBufferSource(): FakeBufferSourceNode {
    return new FakeBufferSourceNode();
  }

  createConvolver(): FakeConvolverNode {
    return new FakeConvolverNode();
  }

  createChannelSplitter(): FakeAudioNode {
    return new FakeAudioNode();
  }

  createAnalyser(): FakeAnalyserNode {
    return new FakeAnalyserNode();
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('analysisStore headroom trim (playback path)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    createdGainNodes = [];
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('setVolume — reachable without any audio graph existing', () => {
    it('clamps into [0,1] and does not throw when nothing is playing (no gainNode yet)', () => {
      const store = useAnalysisStore();

      store.setVolume(1.5);
      expect(store.playbackVolume).toBe(1);

      store.setVolume(-0.3);
      expect(store.playbackVolume).toBe(0);

      store.setVolume(0.42);
      expect(store.playbackVolume).toBeCloseTo(0.42, 10);
    });
  });

  describe('playback() — gainFor()/headroomTrim() applied to the real gain node', () => {
    it('sets gain.value to volume^2 * the measured trim for a processed take', async () => {
      const store = useAnalysisStore();
      await store.loadFile(toneFile('harmonic-e2'));
      const refId = await store.addReference(toneFile('white-noise'));
      await flush();

      const ref = store.references[refId]!;
      expect(ref.ir).not.toBeNull(); // precondition: an IR exists to convolve/measure with
      expect(store.activeReferenceId).toBe(refId);

      await store.playback(1, 'processed', 0, false);

      expect(createdGainNodes.length).toBe(1);

      // Independently reproduce what headroomTrim()/measureTrim() should have computed:
      // the same measurement, against the same IR and the same A-side channels, at A's
      // own sample rate (headroomTrim measures against `playbackChannels('A')`, not the
      // reference's channels — see `measureTrim` in analysisStore.ts).
      const expectedTrim = measureHeadroomTrim(
        ref.ir!.coefficients,
        store.channelBufferA,
        store.sampleRateA,
      ).trim;
      const expectedGain = 1 * 1 * expectedTrim;

      expect(createdGainNodes[0]!.gain.value).toBeCloseTo(expectedGain, 6);

      // setVolume after playback has started must ramp the live node, not throw or
      // recreate it.
      expect(() => store.setVolume(0.5)).not.toThrow();
      expect(store.playbackVolume).toBeCloseTo(0.5, 10);

      store.stopPlayback();
    });

    it('scales gain by volume^2 at a fixed trim — same IR/audio, half volume', async () => {
      const store = useAnalysisStore();
      await store.loadFile(toneFile('harmonic-e2'));
      const refId = await store.addReference(toneFile('white-noise'));
      await flush();

      await store.playback(1, 'processed', 0, false);
      const fullVolumeGain = createdGainNodes[0]!.gain.value;
      store.stopPlayback();

      await store.playback(0.5, 'processed', 0, false);
      const halfVolumeGain = createdGainNodes[1]!.gain.value;
      store.stopPlayback();

      // Same IR, same audio -> same trim -> the two gains differ by exactly volume^2,
      // i.e. 0.25 (trimCache also means the second call reuses rather than re-measures).
      expect(halfVolumeGain).toBeCloseTo(fullVolumeGain * 0.25, 6);
      void refId;
    });

    it('applies no trim (gain == volume^2) for original (dry) playback, which never convolves', async () => {
      const store = useAnalysisStore();
      await store.loadFile(toneFile('harmonic-e2'));
      await store.addReference(toneFile('white-noise'));
      await flush();

      await store.playback(0.5, 'original', 0, false);

      expect(createdGainNodes[0]!.gain.value).toBeCloseTo(0.25, 10); // 0.5^2 * 1
      store.stopPlayback();
    });
  });
});

// What remains out of reach even with the AudioContext stub above: `headroomTrim()`,
// `measureTrim()`, `boundedTrim()`, and the module-private `trimCache` variable are not
// exported from analysisStore.ts, and there is no test hook that surfaces them directly.
// The assertions above exercise them only indirectly, through the one externally
// observable side effect they have: the value written into the real GainNode's
// `gain.value` at playback start. Cache-hit-vs-miss (whether a second `playback()` call
// with the same IR/source actually skips re-measuring rather than just recomputing the
// same answer) is not independently observable from here — both produce the same trim
// value, so this suite cannot distinguish "reused the cache" from "recomputed it".
