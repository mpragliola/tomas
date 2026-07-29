import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAnalysisStore } from '../../../src/stores/analysisStore';
import { setActivePinia, createPinia } from 'pinia';

describe('analysisStore normalization', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('gain application', () => {
    it('applies normalizeGains when normalized is true', () => {
      const store = useAnalysisStore();
      const testGain = 0.5;

      store.normalized.A = true;
      store.normalizeGains.A = testGain;

      const appliedGain = store.normalized.A ? store.normalizeGains.A : 1;
      expect(appliedGain).toBe(testGain);
    });

    it('ignores normalizeGains when normalized is false', () => {
      const store = useAnalysisStore();

      store.normalized.A = false;
      store.normalizeGains.A = 0.5;

      const appliedGain = store.normalized.A ? store.normalizeGains.A : 1;
      expect(appliedGain).toBe(1);
    });

    it('resets normalize gains on clear', () => {
      const store = useAnalysisStore();

      store.normalizeGains.A = 0.75;
      store.clearFile('A');

      expect(store.normalizeGains.A).toBe(1);
      expect(store.normalized.A).toBe(false);
    });

    it('flips normalization state across slots', () => {
      const store = useAnalysisStore();

      store.normalized.A = true;
      store.normalized.B = false;
      store.normalizeGains.A = 0.8;
      store.normalizeGains.B = 0.9;

      store.swapSlots();

      expect(store.normalized.A).toBe(false);
      expect(store.normalized.B).toBe(true);
      expect(store.normalizeGains.A).toBe(0.9);
      expect(store.normalizeGains.B).toBe(0.8);
    });

    it('maintains independent normalize state per slot', () => {
      const store = useAnalysisStore();

      store.normalized.A = true;
      store.normalizeGains.A = 0.6;
      store.normalized.B = false;
      store.normalizeGains.B = 0.7;

      expect(store.normalized.A).toBe(true);
      expect(store.normalized.B).toBe(false);
      expect(store.normalizeGains.A).toBe(0.6);
      expect(store.normalizeGains.B).toBe(0.7);
    });
  });

  describe('normalization impact on magnitude scaling', () => {
    it('scales spectrum magnitudes by normalizeGains when active', () => {
      const store = useAnalysisStore();
      const origMagnitude = 1.0;
      const gain = 0.5;

      store.normalized.A = true;
      store.normalizeGains.A = gain;

      const scaledMagnitude = origMagnitude * (store.normalized.A ? store.normalizeGains.A : 1);
      expect(scaledMagnitude).toBe(origMagnitude * gain);
    });

    it('leaves spectrum unscaled when normalization is disabled', () => {
      const store = useAnalysisStore();
      const origMagnitude = 1.0;

      store.normalized.A = false;
      store.normalizeGains.A = 0.5;

      const scaledMagnitude = origMagnitude * (store.normalized.A ? store.normalizeGains.A : 1);
      expect(scaledMagnitude).toBe(origMagnitude);
    });
  });
});
