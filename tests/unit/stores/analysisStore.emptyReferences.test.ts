import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAnalysisStore } from '../../../src/stores/analysisStore';
import { setActivePinia, createPinia } from 'pinia';
import { toneFile } from '../../fixtures';

/**
 * Empty reference tabs (created via "+", filled in later by a file or a recording) and
 * recording generalized to target any reference tab, not just A. See the multi-reference
 * plan (`let-s-plan-a-complex-cached-turtle.md`) for the base feature; this extends it
 * per later user direction.
 *
 * `AudioRecorder` is mocked here rather than exercised for real — it drives getUserMedia,
 * which node has no equivalent of. `start` is a no-op; `stop` hands back a synthetic
 * signal long enough to clear `MIN_ANALYSIS_SECONDS` (`analysisStore.references.test.ts`
 * uses real fixtures for the file-load paths since those don't touch the recorder at all).
 */
let recorderCallCount = 0;
vi.mock('../../../src/services/audio/recorder', () => {
  class FakeAudioRecorder {
    async start(): Promise<void> {}
    async stop(): Promise<Float32Array> {
      recorderCallCount++;
      const n = 88200; // 2s @ 44100Hz — comfortably past the 1s analysis floor
      const data = new Float32Array(n);
      // A distinct frequency per call, so two takes are never accidentally equal.
      const freq = 200 + recorderCallCount * 37;
      for (let i = 0; i < n; i++) data[i] = Math.sin((i / 44100) * 2 * Math.PI * freq) * 0.5;
      return data;
    }
    getState() {
      return {
        isRecording: false,
        isArmed: false,
        isPaused: false,
        recordedDuration: 0,
        level: 0,
        inputChannels: 1,
        channelIndex: 0,
      };
    }
  }
  return { AudioRecorder: FakeAudioRecorder };
});

const RECORDER_CONFIG = {
  sampleRate: 44100 as const,
  maxDuration: 20000,
  channelCount: 1 as const,
  channelIndex: 0,
  autoThreshold: -40,
};

describe('analysisStore empty references and reference recording', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('addEmptyReference', () => {
    it('creates empty tabs up to MAX_REFERENCES and rejects the one past it', () => {
      const store = useAnalysisStore();

      const ids: string[] = [];
      for (let i = 0; i < store.MAX_REFERENCES; i++) {
        const id = store.addEmptyReference();
        expect(id, `add #${i + 1}`).not.toBe('');
        ids.push(id);
      }

      expect(store.referenceOrder.length).toBe(store.MAX_REFERENCES);
      expect(new Set(ids).size).toBe(store.MAX_REFERENCES);
      for (const id of ids) {
        expect(store.references[id]!.assetId).toBeNull();
        expect(store.references[id]!.stale).toBe(false); // nothing to be stale about yet
      }

      const rejected = store.addEmptyReference();
      expect(rejected).toBe('');
      expect(store.referenceOrder.length).toBe(store.MAX_REFERENCES);
      expect(store.lastError).not.toBeNull();
    });

    it('activates every empty tab immediately, unlike addReference (only the first)', () => {
      const store = useAnalysisStore();

      const first = store.addEmptyReference();
      expect(store.activeReferenceId).toBe(first);

      const second = store.addEmptyReference();
      expect(store.activeReferenceId).toBe(second);
    });

    it('disambiguates the placeholder label across multiple empty tabs', () => {
      const store = useAnalysisStore();
      const first = store.addEmptyReference();
      const second = store.addEmptyReference();
      expect(store.references[first]!.label).not.toBe(store.references[second]!.label);
    });
  });

  describe('addReference(file, targetId)', () => {
    it('fills an existing empty tab instead of creating a new one', async () => {
      const store = useAnalysisStore();
      await store.loadFile(toneFile('harmonic-e2'));
      const emptyId = store.addEmptyReference();
      expect(store.referenceOrder.length).toBe(1);

      const resultId = await store.addReference(toneFile('white-noise'), emptyId);

      expect(resultId).toBe(emptyId);
      expect(store.referenceOrder.length).toBe(1); // no second tab created
      expect(store.references[emptyId]!.assetId).not.toBeNull();
      expect(store.references[emptyId]!.label).toContain('white-noise');
      expect(store.references[emptyId]!.selection.endSample).toBeGreaterThan(0);
    });

    it('recomputes immediately when the filled-in tab is the active one', async () => {
      const store = useAnalysisStore();
      await store.loadFile(toneFile('harmonic-e2'));
      const emptyId = store.addEmptyReference(); // auto-activates
      expect(store.activeReferenceId).toBe(emptyId);

      await store.addReference(toneFile('white-noise'), emptyId);

      expect(store.references[emptyId]!.ir).not.toBeNull();
      expect(store.references[emptyId]!.stale).toBe(false);
    });

    it('rejects a targetId that already points at a filled reference, without creating a new tab', async () => {
      const store = useAnalysisStore();
      await store.loadFile(toneFile('sine-1k'));
      const filledId = await store.addReference(toneFile('sine-1k'));
      const before = store.referenceOrder.length;

      const result = await store.addReference(toneFile('white-noise'), filledId);

      expect(result).toBe('');
      expect(store.referenceOrder.length).toBe(before);
      expect(store.lastError).not.toBeNull();
    });

    it('does not count a targetId fill against MAX_REFERENCES', async () => {
      const store = useAnalysisStore();
      for (let i = 0; i < store.MAX_REFERENCES; i++) store.addEmptyReference();
      const [firstId] = store.referenceOrder;

      const resultId = await store.addReference(toneFile('sine-1k'), firstId);

      expect(resultId).toBe(firstId);
      expect(store.referenceOrder.length).toBe(store.MAX_REFERENCES); // unchanged, still at the ceiling
    });
  });

  describe('recording into a reference tab', () => {
    it('tracks recordingTarget while recording and clears it after stop, same as A', async () => {
      const store = useAnalysisStore();
      expect(store.recordingTarget).toBeNull();

      await store.recordAudio(RECORDER_CONFIG);
      expect(store.recordingTarget).toBe('A');

      await store.stopRecording();
      expect(store.recordingTarget).toBeNull();
      expect(store.audioBufferA.length).toBeGreaterThan(0);
    });

    it('creates a new asset for the reference and does not disturb A or a different reference', async () => {
      const store = useAnalysisStore();
      await store.loadFile(toneFile('harmonic-e2'));
      const aLengthBefore = store.audioBufferA.length;

      const otherId = await store.addReference(toneFile('white-noise'));
      const otherAssetId = store.references[otherId]!.assetId!;
      const otherBufferBefore = store.audioAssets[otherAssetId]!.buffer;

      const emptyId = store.addEmptyReference();
      expect(store.recordingTarget).toBeNull();

      await store.recordAudio(RECORDER_CONFIG, { referenceId: emptyId });
      expect(store.recordingTarget).toEqual({ referenceId: emptyId });

      await store.stopRecording();
      expect(store.recordingTarget).toBeNull();

      const ref = store.references[emptyId]!;
      expect(ref.assetId).not.toBeNull();
      expect(ref.label).toContain('Live take');

      const asset = store.audioAssets[ref.assetId!]!;
      expect(asset.buffer.length).toBeGreaterThan(0);
      expect(asset.sampleRate).toBe(44100);

      // A untouched.
      expect(store.audioBufferA.length).toBe(aLengthBefore);
      // The other reference's asset is a completely different object — recording into
      // the empty tab must not have touched it, aliased it, or GC'd it.
      expect(store.references[otherId]!.assetId).toBe(otherAssetId);
      expect(store.audioAssets[otherAssetId]!.buffer).toBe(otherBufferBefore);
    });

    it('disambiguates the "Live take" label across multiple recorded reference tabs', async () => {
      const store = useAnalysisStore();
      const id1 = store.addEmptyReference();
      await store.recordAudio(RECORDER_CONFIG, { referenceId: id1 });
      await store.stopRecording();

      const id2 = store.addEmptyReference();
      await store.recordAudio(RECORDER_CONFIG, { referenceId: id2 });
      await store.stopRecording();

      expect(store.references[id1]!.label).not.toBe(store.references[id2]!.label);
    });

    it('recomputes immediately when recording lands in the active tab', async () => {
      const store = useAnalysisStore();
      await store.loadFile(toneFile('harmonic-e2'));
      const emptyId = store.addEmptyReference();
      expect(store.activeReferenceId).toBe(emptyId);

      await store.recordAudio(RECORDER_CONFIG, { referenceId: emptyId });
      await store.stopRecording();

      expect(store.references[emptyId]!.ir).not.toBeNull();
      expect(store.references[emptyId]!.stale).toBe(false);
    });

    it('drops the take cleanly if the target reference was removed mid-recording', async () => {
      const store = useAnalysisStore();
      const emptyId = store.addEmptyReference();

      await store.recordAudio(RECORDER_CONFIG, { referenceId: emptyId });
      store.removeReference(emptyId);

      await expect(store.stopRecording()).resolves.not.toThrow();
      expect(store.recordingTarget).toBeNull();
      expect(store.references[emptyId]).toBeUndefined();
    });
  });

  describe('empty tabs and the spectrumA staleness watch', () => {
    it('does not mark an empty tab stale when A recomputes, even while it is active', async () => {
      const store = useAnalysisStore();
      const emptyId = store.addEmptyReference(); // auto-activates
      expect(store.activeReferenceId).toBe(emptyId);

      // Loading A recomputes spectrumA, which used to mark every reference (including
      // empty ones) stale — with the active tab being empty, that queued a recompute
      // doomed to fail (`Reference X has no audio loaded`), surfacing as a
      // "Couldn't refresh that reference — try again." toast on every single A edit.
      await store.loadFile(toneFile('harmonic-e2'));

      expect(store.references[emptyId]!.stale).toBe(false);
      expect(store.lastError).toBeNull();
    });

    it('does not mark an empty tab stale when A is cleared', async () => {
      const store = useAnalysisStore();
      await store.loadFile(toneFile('harmonic-e2'));
      const emptyId = store.addEmptyReference();

      store.clearFile();

      expect(store.references[emptyId]!.stale).toBe(false);
    });

    it('still marks a background filled reference stale on A recompute, while the active empty tab is left alone (the exact regression scenario: an empty tab stays active while A is edited)', async () => {
      const store = useAnalysisStore();
      await store.loadFile(toneFile('harmonic-e2'));
      const filledId = await store.addReference(toneFile('white-noise'));
      expect(store.references[filledId]!.stale).toBe(false);

      // Adding the empty tab switches `activeReferenceId` to it — `filledId` is now the
      // background reference. This is the actual bug scenario: the active tab is empty
      // while A keeps changing (e.g. the user drags A's selection repeatedly).
      const emptyId = store.addEmptyReference();
      expect(store.activeReferenceId).toBe(emptyId);

      // Before the fix this queued a doomed recompute for the *active* (empty) tab via
      // `window.setTimeout`, which throws in this environment (no `window`) — if that
      // path were still reachable, this call itself would blow up. Filled-but-inactive
      // `filledId` still needs to end up properly stale so it recomputes correctly
      // whenever it's next selected.
      await store.loadFile(toneFile('sine-1k'));

      expect(store.references[filledId]!.stale).toBe(true);
      expect(store.references[emptyId]!.stale).toBe(false);
      expect(store.lastError).toBeNull();
    });
  });
});
