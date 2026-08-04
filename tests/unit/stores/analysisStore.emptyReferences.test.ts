import { describe, it, expect, beforeEach } from 'vitest';
import { useAnalysisStore } from '../../../src/stores/analysisStore';
import { setActivePinia, createPinia } from 'pinia';
import { toneFile } from '../../fixtures';
import { parseWavFile } from '../../../src/services/audio/wavParser';
import { loadFixtureIntoA, addFixtureReference } from './helpers';

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

  describe('finishLoadIntoReference (filling an empty tab via waver\'s own Load button)', () => {
    it('fills an existing empty tab instead of creating a new one', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'harmonic-e2');
      const emptyId = store.addEmptyReference();
      expect(store.referenceOrder.length).toBe(1);

      const parsed = await parseWavFile(toneFile('white-noise'));
      await store.finishLoadIntoReference(emptyId, 'white-noise', parsed.audioData, parsed.channels, parsed.header.sampleRate);

      expect(store.referenceOrder.length).toBe(1); // no second tab created
      expect(store.references[emptyId]!.assetId).not.toBeNull();
      expect(store.references[emptyId]!.label).toContain('white-noise');
      expect(store.references[emptyId]!.selection.endSample).toBeGreaterThan(0);
    });

    it('recomputes immediately when the filled-in tab is the active one', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'harmonic-e2');
      const emptyId = store.addEmptyReference(); // auto-activates
      expect(store.activeReferenceId).toBe(emptyId);

      const parsed = await parseWavFile(toneFile('white-noise'));
      await store.finishLoadIntoReference(emptyId, 'white-noise', parsed.audioData, parsed.channels, parsed.header.sampleRate);

      expect(store.references[emptyId]!.ir).not.toBeNull();
      expect(store.references[emptyId]!.stale).toBe(false);
    });

    it('does not count filling an existing empty tab against MAX_REFERENCES', async () => {
      const store = useAnalysisStore();
      for (let i = 0; i < store.MAX_REFERENCES; i++) store.addEmptyReference();
      const [firstId] = store.referenceOrder;

      const parsed = await parseWavFile(toneFile('sine-1k'));
      await store.finishLoadIntoReference(firstId, 'sine-1k', parsed.audioData, parsed.channels, parsed.header.sampleRate);

      expect(store.referenceOrder.length).toBe(store.MAX_REFERENCES); // unchanged, still at the ceiling
      expect(store.references[firstId]!.assetId).not.toBeNull();
    });
  });

  describe('finishing a recording into A or a reference tab', () => {
    function fakeTake(freqOffset = 0): Float32Array {
      const n = 88200; // 2s @ 44100Hz — comfortably past the 1s analysis floor
      const data = new Float32Array(n);
      const freq = 200 + freqOffset;
      for (let i = 0; i < n; i++) data[i] = Math.sin((i / 44100) * 2 * Math.PI * freq) * 0.5;
      return data;
    }

    it('finishRecordingIntoA saves the take and recomputes A\'s spectrum', async () => {
      const store = useAnalysisStore();
      await store.finishRecordingIntoA(fakeTake(), 44100);

      expect(store.audioBufferA.length).toBeGreaterThan(0);
      expect(store.sourceNameA).toBe('Live take');
      expect(store.spectrumA).not.toBeNull();
    });

    it('finishRecordingIntoA respects the sample rate it is given', async () => {
      const store = useAnalysisStore();
      await store.finishRecordingIntoA(fakeTake(), 48000);
      expect(store.sampleRateA).toBe(48000);
    });

    it('finishRecordingIntoReference creates a new asset and does not disturb A or a different reference', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'harmonic-e2');
      const aLengthBefore = store.audioBufferA.length;

      const otherId = await addFixtureReference(store, 'white-noise');
      const otherAssetId = store.references[otherId]!.assetId!;
      const otherBufferBefore = store.audioAssets[otherAssetId]!.buffer;

      const emptyId = store.addEmptyReference();
      await store.finishRecordingIntoReference(emptyId, fakeTake(37), 44100);

      const ref = store.references[emptyId]!;
      expect(ref.assetId).not.toBeNull();
      expect(ref.label).toContain('Live take');

      const asset = store.audioAssets[ref.assetId!]!;
      expect(asset.buffer.length).toBeGreaterThan(0);
      expect(asset.sampleRate).toBe(44100);

      expect(store.audioBufferA.length).toBe(aLengthBefore);
      expect(store.references[otherId]!.assetId).toBe(otherAssetId);
      expect(store.audioAssets[otherAssetId]!.buffer).toBe(otherBufferBefore);
    });

    it('disambiguates the "Live take" label across multiple recorded reference tabs', async () => {
      const store = useAnalysisStore();
      const id1 = store.addEmptyReference();
      await store.finishRecordingIntoReference(id1, fakeTake(1), 44100);

      const id2 = store.addEmptyReference();
      await store.finishRecordingIntoReference(id2, fakeTake(2), 44100);

      expect(store.references[id1]!.label).not.toBe(store.references[id2]!.label);
    });

    it('recomputes immediately when recording lands in the active tab', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'harmonic-e2');
      const emptyId = store.addEmptyReference();
      expect(store.activeReferenceId).toBe(emptyId);

      await store.finishRecordingIntoReference(emptyId, fakeTake(), 44100);

      expect(store.references[emptyId]!.ir).not.toBeNull();
      expect(store.references[emptyId]!.stale).toBe(false);
    });

    it('drops the take cleanly if the target reference was removed mid-recording', async () => {
      const store = useAnalysisStore();
      const emptyId = store.addEmptyReference();
      store.removeReference(emptyId);

      await expect(store.finishRecordingIntoReference(emptyId, fakeTake(), 44100)).resolves.not.toThrow();
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
      await loadFixtureIntoA(store, 'harmonic-e2');

      expect(store.references[emptyId]!.stale).toBe(false);
      expect(store.lastError).toBeNull();
    });

    it('does not mark an empty tab stale when A is cleared', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'harmonic-e2');
      const emptyId = store.addEmptyReference();

      store.clearFile();

      expect(store.references[emptyId]!.stale).toBe(false);
    });

    it('still marks a background filled reference stale on A recompute, while the active empty tab is left alone (the exact regression scenario: an empty tab stays active while A is edited)', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'harmonic-e2');
      const filledId = await addFixtureReference(store, 'white-noise');
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
      await loadFixtureIntoA(store, 'sine-1k');

      expect(store.references[filledId]!.stale).toBe(true);
      expect(store.references[emptyId]!.stale).toBe(false);
      expect(store.lastError).toBeNull();
    });
  });
});
