import { useAnalysisStore } from '../../../src/stores/analysisStore';
import { toneFile } from '../../fixtures';
import { parseWavFile } from '../../../src/services/audio/wavParser';

type Store = ReturnType<typeof useAnalysisStore>;

/**
 * Loads a fixture into A the way `WaveformEditor`'s `@loadsuccess` handler does now that
 * file loading goes through waver's own built-in Load button, not this app's parser:
 * parse it once (`parseWavFile`, same decode the old file-input path used, standing in for
 * waver's own `decodeAudioData`), then hand the decoded shape to `finishLoadIntoA`.
 */
export async function loadFixtureIntoA(store: Store, name: string): Promise<void> {
  const parsed = await parseWavFile(toneFile(name));
  await store.finishLoadIntoA(name, parsed.audioData, parsed.channels, parsed.header.sampleRate);
}

/**
 * Creates a fresh empty reference tab and fills it with a fixture — the two-step flow the
 * "+" button plus waver's own Load button now drive from the UI (a tab is always created
 * empty, then loaded into; there is no more "one call creates a tab and fills it"
 * `addReference`). Returns the new tab's id, or '' if `addEmptyReference` itself was
 * rejected (e.g. already at `MAX_REFERENCES`).
 */
export async function addFixtureReference(store: Store, name: string): Promise<string> {
  const id = store.addEmptyReference();
  if (!id) return '';
  const parsed = await parseWavFile(toneFile(name));
  await store.finishLoadIntoReference(id, name, parsed.audioData, parsed.channels, parsed.header.sampleRate);
  return id;
}
