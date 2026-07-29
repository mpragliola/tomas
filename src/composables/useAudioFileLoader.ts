import { ref } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';
import { SUPPORTED_AUDIO_EXTENSIONS, isSupportedAudioFile } from '../services/audio/audioLoader';
import type { SlotId } from '../types/audio';

const MAX_SIZE = 100 * 1024 * 1024; // 100MB

export interface AudioFileLoaderOptions {
  onLoaded?: (file: File) => void;
  /** Rejected input or a failed decode — surface it to the user. */
  onError?: (message: string, durationMs: number) => void;
}

/** Picking, dropping and validating one slot's audio file. No rendering concerns. */
export function useAudioFileLoader(slot: SlotId, options: AudioFileLoaderOptions = {}) {
  const store = useAnalysisStore();
  const acceptAttr = SUPPORTED_AUDIO_EXTENSIONS.join(',');
  const file = ref<File | null>(null);
  const loading = ref(false);
  const dragActive = ref(false);

  function reject(message: string, context?: Record<string, unknown>): void {
    logger.warn('AudioFileLoader', message, { slot, ...context });
    options.onError?.(message, 3000);
  }

  /** Returns an error string, or null when the file is usable. */
  function validate(candidate: File): string | null {
    if (!isSupportedAudioFile(candidate.name)) {
      const ext = candidate.name.split('.').pop() || 'unknown';
      return `Invalid file type. Expected one of ${SUPPORTED_AUDIO_EXTENSIONS.join(', ')}, got ${ext}`;
    }
    if (candidate.size === 0) return 'File is empty';
    if (candidate.size > MAX_SIZE) {
      return `File too large. Max 100MB, got ${(candidate.size / 1024 / 1024).toFixed(1)}MB`;
    }
    return null;
  }

  async function loadFile(candidate: File): Promise<void> {
    const error = validate(candidate);
    if (error) {
      reject(error, { fileName: candidate.name, size: candidate.size });
      return;
    }

    loading.value = true;
    file.value = candidate;
    try {
      await store.loadFile(candidate, slot);
      options.onLoaded?.(candidate);
      logger.info('AudioFileLoader', `File loaded: ${slot}`, {
        fileName: candidate.name,
        size: candidate.size,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('AudioFileLoader', `Failed to load file ${slot}`, { error: message });
      options.onError?.(`Failed to load ${slot}: ${message}`, 5000);
      file.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function handleFileSelect(event: Event): Promise<void> {
    const files = (event.target as HTMLInputElement).files;
    if (files && files.length > 0) await loadFile(files[0]);
  }

  async function handleDrop(event: DragEvent): Promise<void> {
    dragActive.value = false;
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const dropped = Array.from(files).find((f) => isSupportedAudioFile(f.name));
    if (dropped) await loadFile(dropped);
    else logger.warn('AudioFileLoader', 'Dropped file is not a supported audio type', { slot });
  }

  function clear(): void {
    file.value = null;
    store.clearFile(slot);
    logger.info('AudioFileLoader', `File cleared: ${slot}`);
  }

  return {
    acceptAttr,
    file,
    loading,
    dragActive,
    loadFile,
    handleFileSelect,
    handleDrop,
    clear,
  };
}
