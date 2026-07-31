import { ref } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';
import { SUPPORTED_AUDIO_EXTENSIONS, isSupportedAudioFile } from '../services/audio/audioLoader';

const MAX_SIZE = 100 * 1024 * 1024; // 100MB

export interface ReferenceFileLoaderOptions {
  onLoaded?: (id: string, file: File) => void;
  /** Rejected input, a failed decode, or a store-side rejection (e.g. MAX_REFERENCES
   * already reached) — surface it to the user. */
  onError?: (message: string, durationMs: number) => void;
}

/**
 * Picking, dropping and validating a new reference tab's audio file. Same validation and
 * drag/drop shape as `useAudioFileLoader`, but not bound to a single slot — each call to
 * `loadFile` can add a new tab (up to `MAX_REFERENCES`), and `clear` takes an explicit
 * reference id rather than acting on one implicit `file` ref.
 */
export function useReferenceFileLoader(options: ReferenceFileLoaderOptions = {}) {
  const store = useAnalysisStore();
  const acceptAttr = SUPPORTED_AUDIO_EXTENSIONS.join(',');
  const loading = ref(false);
  const dragActive = ref(false);

  function reject(message: string, context?: Record<string, unknown>): void {
    logger.warn('ReferenceFileLoader', message, context);
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

  /** Adds a new reference tab. Returns the new reference id, or null on failure — a
   * failed validation, decode, or a store-side rejection (`addReference` returns '' once
   * MAX_REFERENCES is already open, having set `store.lastError` first). */
  async function loadFile(candidate: File): Promise<string | null> {
    const error = validate(candidate);
    if (error) {
      reject(error, { fileName: candidate.name, size: candidate.size });
      return null;
    }

    loading.value = true;
    try {
      const id = await store.addReference(candidate);
      if (!id) {
        reject(store.lastError?.message ?? 'Could not add reference', { fileName: candidate.name });
        return null;
      }
      options.onLoaded?.(id, candidate);
      logger.info('ReferenceFileLoader', 'Reference loaded', {
        id,
        fileName: candidate.name,
        size: candidate.size,
      });
      return id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('ReferenceFileLoader', 'Failed to load reference', { error: message });
      options.onError?.(`Failed to load reference: ${message}`, 5000);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /** Loads a file into an EXISTING empty reference tab (a "+"-created placeholder, or
   * any tab that hasn't been filled in yet) instead of creating a new one. Returns
   * whether it landed — false on validation failure, decode failure, or a store-side
   * rejection (e.g. `id` doesn't actually point at an empty tab). */
  async function loadFileInto(id: string, candidate: File): Promise<boolean> {
    const error = validate(candidate);
    if (error) {
      reject(error, { fileName: candidate.name, size: candidate.size });
      return false;
    }

    loading.value = true;
    try {
      const resultId = await store.addReference(candidate, id);
      if (!resultId) {
        reject(store.lastError?.message ?? 'Could not load file into that reference', { fileName: candidate.name });
        return false;
      }
      options.onLoaded?.(resultId, candidate);
      logger.info('ReferenceFileLoader', 'Reference filled in from empty', { id: resultId, fileName: candidate.name });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('ReferenceFileLoader', 'Failed to load file into reference', { error: message });
      options.onError?.(`Failed to load reference: ${message}`, 5000);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /** Loads every dropped/picked file up to the MAX_REFERENCES ceiling — a drop can carry
   * more than one file, unlike A's loader which only ever keeps the first. */
  async function loadFiles(candidates: File[]): Promise<string[]> {
    const ids: string[] = [];
    for (const candidate of candidates) {
      const id = await loadFile(candidate);
      if (id) ids.push(id);
    }
    return ids;
  }

  async function handleFileSelect(event: Event): Promise<string[]> {
    const files = (event.target as HTMLInputElement).files;
    if (!files || files.length === 0) return [];
    return loadFiles(Array.from(files));
  }

  async function handleDrop(event: DragEvent): Promise<string[]> {
    dragActive.value = false;
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return [];

    const dropped = Array.from(files).filter((f) => isSupportedAudioFile(f.name));
    if (dropped.length === 0) {
      logger.warn('ReferenceFileLoader', 'Dropped file(s) are not a supported audio type');
      return [];
    }
    return loadFiles(dropped);
  }

  function clear(id: string): void {
    store.removeReference(id);
    logger.info('ReferenceFileLoader', 'Reference cleared', { id });
  }

  return {
    acceptAttr,
    loading,
    dragActive,
    loadFile,
    loadFileInto,
    loadFiles,
    handleFileSelect,
    handleDrop,
    clear,
  };
}
