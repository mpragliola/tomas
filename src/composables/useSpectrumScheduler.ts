import { onUnmounted } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';
import type { WaveformTarget } from './useWaveformSlot';

export interface SpectrumSchedulerOptions {
  delayMs?: number;
  /** The recompute was refused — a selection too short to average, typically. The
   * caller surfaces it, otherwise the drag looks like it simply did nothing. */
  onError?: (message: string) => void;
  /** A later selection worked, so a refusal still on screen is stale. */
  onSuccess?: () => void;
}

/**
 * Recompute a target's spectrum after its data or selection changed, debounced so
 * dragging a region does not thrash the FFT.
 */
export function useSpectrumScheduler(getTarget: () => WaveformTarget, options: SpectrumSchedulerOptions = {}) {
  const { delayMs = 250, onError, onSuccess } = options;
  const store = useAnalysisStore();
  let timer: number | null = null;

  // A function, not a value snapshot — the same WaveformEditor instance (and this
  // composable's one setup call) is reused across reference tab switches, so reading
  // `getTarget()` fresh each time is what keeps a debounced schedule() targeting whichever
  // tab is actually active by the time its timer fires, not whichever was active when this
  // composable was first set up. See useWaveformSlot.ts for the same fix on the waveform side.
  function bufferLength(): number {
    const target = getTarget();
    if (target === 'A') return store.audioBufferA.length;
    const ref = store.references[target.referenceId];
    const asset = ref?.assetId ? store.audioAssets[ref.assetId] : undefined;
    return asset?.buffer.length ?? 0;
  }

  function cancel(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(): void {
    cancel();
    timer = window.setTimeout(async () => {
      timer = null;
      if (bufferLength() === 0) return;
      const target = getTarget();
      try {
        if (target === 'A') {
          await store.computeSpectrumA(store.fftConfig);
        } else {
          await store.computeReferenceSpectrum(target.referenceId, store.fftConfig);
        }
        onSuccess?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const label = target === 'A' ? 'A' : target.referenceId;
        logger.error('SpectrumScheduler', `Failed to compute spectrum ${label}`, {
          error: message,
        });
        onError?.(message);
      }
    }, delayMs);
  }

  onUnmounted(cancel);

  return { schedule, cancel };
}
