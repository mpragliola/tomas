import { describe, it, expect, beforeEach } from 'vitest';
import { useAnalysisStore } from '../../../src/stores/analysisStore';
import { setActivePinia, createPinia } from 'pinia';
import { loadFixtureIntoA, addFixtureReference } from './helpers';

/**
 * The multi-reference data model: `AudioAsset`s (decoded audio, deduped) and
 * `ReferenceState`s (a tab's loop + its own independently-computed spectrum/IR), see
 * `let-s-plan-a-complex-cached-turtle.md`. Replaces `analysisStore.normalization.test.ts`,
 * whose whole premise (`normalized`/`normalizeGains`, `swapSlots`) no longer exists —
 * see `git show 2922146` for why those fields were already dead before this refactor.
 *
 * Runs against the real committed fixtures (`tests/fixtures`), same convention as
 * `wavParser.test.ts` / `core-flow.test.ts`. File loading itself now goes through waver's
 * own built-in Load button (decoded via `decodeAudioData`, not this app's parser) — this
 * suite exercises the store's own side of that path, `finishLoadIntoA`/
 * `finishLoadIntoReference`, via the `loadFixtureIntoA`/`addFixtureReference` helpers
 * (see `./helpers.ts`). Reference tabs are created one at a time via `addEmptyReference`
 * (the "+" button's own action) and then filled, mirroring how a tab only ever gets audio
 * now: created empty, then loaded into.
 */

/** Waits out the microtask chain a fire-and-forget recompute (`setActiveReference` on a
 * stale tab) runs through, without relying on fake timers. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('analysisStore references', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('addEmptyReference + finishLoadIntoReference', () => {
    it('adds up to MAX_REFERENCES and rejects the one past it', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'sine-1k');

      const ids: string[] = [];
      for (let i = 0; i < store.MAX_REFERENCES; i++) {
        const id = await addFixtureReference(store, 'sine-1k');
        expect(id, `add #${i + 1}`).not.toBe('');
        ids.push(id);
      }

      expect(store.referenceOrder.length).toBe(store.MAX_REFERENCES);
      expect(new Set(ids).size).toBe(store.MAX_REFERENCES); // every id distinct

      const rejectedId = await addFixtureReference(store, 'sine-1k');
      expect(rejectedId).toBe('');
      expect(store.referenceOrder.length).toBe(store.MAX_REFERENCES);
      expect(store.lastError).not.toBeNull();
    });

    it('activates a newly-created empty tab immediately', async () => {
      // Unlike the old file-picker addReference() (only the first of several adds
      // auto-activated), a tab is now always created empty via the "+" button — which
      // always activates the tab it creates — and filled in afterward.
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'harmonic-e2');

      const first = await addFixtureReference(store, 'white-noise');
      expect(store.activeReferenceId).toBe(first);

      const second = await addFixtureReference(store, 'white-noise-eq');
      expect(store.activeReferenceId).toBe(second);
    });
  });

  describe('cloneReference', () => {
    it('shares assetId but gets a distinct id and independent computed state', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'harmonic-e2'); // 1s @ 48kHz — exactly the analysis floor

      const sourceId = await addFixtureReference(store, 'white-noise'); // 2s, flat noise
      const asset = store.references[sourceId]!.assetId;

      const cloneId = store.cloneReference(sourceId);
      expect(cloneId).not.toBe('');
      expect(cloneId).not.toBe(sourceId);
      expect(store.references[cloneId]!.assetId).toBe(asset);
      expect(store.referenceOrder).toContain(cloneId);

      // Selection copied from the source at clone time, not reset to the full range.
      expect(store.references[cloneId]!.selection).toEqual(store.references[sourceId]!.selection);

      // Computed fields are never shared, even before either selection changes.
      expect(store.references[cloneId]!.spectrum).toBeNull();
      expect(store.references[cloneId]!.ir).toBeNull();
      expect(store.references[cloneId]!.stale).toBe(true);

      // Give each tab a different loop off the same 2s noise file, then compute both
      // independently. Set directly rather than through `updateReferenceSelection` —
      // that action schedules a `window.setTimeout`-based debounce meant for a browser
      // tab, which isn't available in this suite's node test environment; the compute
      // calls right below are what this test actually needs to exercise.
      store.references[sourceId]!.selection = { startSample: 0, endSample: 48000, duration: 1000 };
      store.references[cloneId]!.selection = { startSample: 48000, endSample: 96000, duration: 1000 };

      await store.computeReferenceSpectrum(sourceId, store.fftConfig);
      await store.computeReferenceToneMatchIR(sourceId);
      await store.computeReferenceSpectrum(cloneId, store.fftConfig);
      await store.computeReferenceToneMatchIR(cloneId);

      const sourceRef = store.references[sourceId]!;
      const cloneRef = store.references[cloneId]!;

      expect(sourceRef.spectrum).not.toBeNull();
      expect(cloneRef.spectrum).not.toBeNull();
      // Not the same object...
      expect(sourceRef.spectrum).not.toBe(cloneRef.spectrum);
      expect(sourceRef.ir).not.toBe(cloneRef.ir);
      // ...and not accidentally equal either, since they were computed on different halves
      // of the noise file (a real aliasing bug — both pointing at the same underlying
      // Float32Array — would make these compare equal).
      expect(sourceRef.spectrum!.magnitudesDb).not.toEqual(cloneRef.spectrum!.magnitudesDb);
      expect(sourceRef.ir!.coefficients).not.toEqual(cloneRef.ir!.coefficients);

      // The underlying asset itself genuinely is shared (that's the point of a clone).
      expect(store.audioAssets[asset]).toBeDefined();
      expect(store.references[sourceId]!.assetId).toBe(store.references[cloneId]!.assetId);
    });

    it('rejects cloning past MAX_REFERENCES', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'sine-1k');
      const sourceId = await addFixtureReference(store, 'sine-1k');
      for (let i = 1; i < store.MAX_REFERENCES; i++) {
        await addFixtureReference(store, 'sine-1k');
      }
      expect(store.referenceOrder.length).toBe(store.MAX_REFERENCES);

      const rejected = store.cloneReference(sourceId);
      expect(rejected).toBe('');
      expect(store.referenceOrder.length).toBe(store.MAX_REFERENCES);
    });
  });

  describe('removeReference', () => {
    it('garbage-collects an orphaned asset but keeps one a sibling clone still points at', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'sine-1k');

      const id1 = await addFixtureReference(store, 'white-noise');
      const assetId = store.references[id1]!.assetId;
      const id2 = store.cloneReference(id1);

      expect(store.audioAssets[assetId]).toBeDefined();

      store.removeReference(id1);
      expect(store.references[id1]).toBeUndefined();
      expect(store.referenceOrder).not.toContain(id1);
      // id2 still points at the asset — must survive.
      expect(store.audioAssets[assetId]).toBeDefined();

      store.removeReference(id2);
      expect(store.references[id2]).toBeUndefined();
      // No reference left pointing at it — now it's gone.
      expect(store.audioAssets[assetId]).toBeUndefined();
    });

    it('activates a sibling when the active tab is removed', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'sine-1k');

      const id1 = await addFixtureReference(store, 'sine-1k');
      const id2 = await addFixtureReference(store, 'sine-1k');
      const id3 = await addFixtureReference(store, 'sine-1k');
      expect(store.activeReferenceId).toBe(id3); // each add activates the tab it creates

      store.removeReference(id3);
      await flush();
      expect(store.activeReferenceId).toBe(id2);

      store.removeReference(id2);
      store.removeReference(id1);
      await flush();
      expect(store.activeReferenceId).toBeNull();
    });
  });

  describe('setActiveReference', () => {
    it('recomputes a stale tab before activating it', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'harmonic-e2');
      const id = await addFixtureReference(store, 'white-noise');

      await flush();
      const ref = store.references[id]!;
      expect(ref.stale).toBe(false);
      expect(ref.ir).not.toBeNull();
      const irBefore = ref.ir;

      // Force it stale again without going through updateReferenceSelection, so this
      // test isolates setActiveReference's own recompute path from the debounced one.
      ref.stale = true;
      store.setActiveReference(id);
      await flush();

      expect(store.activeReferenceId).toBe(id);
      expect(ref.stale).toBe(false);
      expect(ref.ir).not.toBeNull();
      expect(ref.ir).not.toBe(irBefore); // recomputed — a fresh object
    });

    it('does not recompute an already-fresh tab', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'harmonic-e2');
      const id = await addFixtureReference(store, 'white-noise');
      await flush();

      const ref = store.references[id]!;
      expect(ref.stale).toBe(false);
      const irBefore = ref.ir;
      const spectrumBefore = ref.spectrum;

      store.setActiveReference(id);
      await flush();

      expect(ref.ir).toBe(irBefore); // same object — nothing re-rendered
      expect(ref.spectrum).toBe(spectrumBefore);
    });

    it('activating a second reference does not disturb the first one', async () => {
      const store = useAnalysisStore();
      await loadFixtureIntoA(store, 'harmonic-e2');
      const id1 = await addFixtureReference(store, 'white-noise');
      await flush();
      const ir1 = store.references[id1]!.ir;

      const id2 = await addFixtureReference(store, 'white-noise-eq');
      await flush();
      // addFixtureReference's addEmptyReference() activates id2 immediately (unlike the
      // old addReference(), which left every add but the first inactive) — restore id1 as
      // active first, so this test isolates setActiveReference's per-tab recompute rather
      // than re-testing tab creation's own activation rule (covered above).
      expect(store.references[id2]!.stale).toBe(false); // just activated and computed by the add
      store.setActiveReference(id1);
      await flush();
      expect(store.activeReferenceId).toBe(id1);

      store.setActiveReference(id2);
      await flush();

      expect(store.activeReferenceId).toBe(id2);
      expect(store.references[id2]!.ir).not.toBeNull();
      // id1's own IR untouched by computing id2's.
      expect(store.references[id1]!.ir).toBe(ir1);
    });
  });
});
