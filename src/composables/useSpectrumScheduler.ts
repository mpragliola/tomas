import { onUnmounted } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';
import type { SlotId } from '../types/audio';

export interface SpectrumSchedulerOptions {
  delayMs?: number;
  /** The recompute was refused — a selection too short to average, typically. The
   * caller surfaces it, otherwise the drag looks like it simply did nothing. */
  onError?: (message: string) => void;
  /** A later selection worked, so a refusal still on screen is stale. */
  onSuccess?: () => void;
}

/**
 * Recompute a slot's spectrum after its data or selection changed, debounced so
 * dragging a region does not thrash the FFT.
 */
export function useSpectrumScheduler(slot: SlotId, options: SpectrumSchedulerOptions = {}) {
  const { delayMs = 250, onError, onSuccess } = options;
  const store = useAnalysisStore();
  let timer: number | null = null;

  function cancel(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(): void {
    cancel();
    timer = window.setTimeout(async () => {
      timer = null;
      if (store.audioBuffers[slot].length === 0) return;
      try {
        await store.computeSpectra(store.fftConfig, slot);
        onSuccess?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('SpectrumScheduler', `Failed to compute spectrum ${slot}`, {
          error: message,
        });
        onError?.(message);
      }
    }, delayMs);
  }

  onUnmounted(cancel);

  return { schedule, cancel };
}
