import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWavFile } from '../../src/services/audio/wavParser';
import manifestJson from './tones/manifest.json';

/**
 * Access to the pre-generated WAV fixtures in `tones/`.
 *
 * The files are committed audio, not something built at test time: `npm run
 * fixtures:generate` writes them and nothing else does. That means a test failure is
 * always about the code under test, never about a generator that changed underneath it,
 * and any fixture can be dropped into an audio editor when a DSP assertion starts
 * failing for reasons nobody can see from the numbers alone.
 */

export interface ToneFixture {
  name: string;
  file: string;
  description: string;
  sampleRate: number;
  bitDepth: number;
  channels: number;
  frames: number;
  seconds: number;
  /**
   * True when the tone has usable energy across most of the audible band. Only these are
   * meaningful for tone matching — a 1 kHz sine says nothing about 5 kHz.
   */
  broadband: boolean;
  /** For a reference take: the working take it was derived from... */
  pairedWith?: string;
  /** ...and the curve that was applied to make it, as named in `curves.mjs`. */
  curve?: 'target' | 'flat';
}

export const TONES: ToneFixture[] = manifestJson.tones as ToneFixture[];

export const BROADBAND_TONES = TONES.filter((tone) => tone.broadband);

export function toneInfo(name: string): ToneFixture {
  const fixture = TONES.find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`Unknown tone fixture: ${name}`);
  return fixture;
}

/** Raw bytes, for tests that care about the container rather than the audio. */
export function toneBytes(name: string): Uint8Array {
  const { file } = toneInfo(name);
  // Copied out of the Buffer: Node pools Buffer memory, so a caller reaching for
  // `bytes.buffer` on the raw read would be pointing at the middle of a shared block.
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./tones/${file}`, import.meta.url))));
}

/** The fixture as a `File`, i.e. exactly what the app's upload path receives. */
export function toneFile(name: string): File {
  const { file } = toneInfo(name);
  return new File([toneBytes(name)], file, { type: 'audio/wav' });
}

const decoded = new Map<string, Promise<{ audioData: Float32Array; sampleRate: number }>>();

/**
 * Decode a fixture to mono samples through the app's own parser, cached per test file —
 * several tests want the same four-second take and decoding it once keeps the suite quick.
 */
export function loadTone(name: string): Promise<{ audioData: Float32Array; sampleRate: number }> {
  let pending = decoded.get(name);
  if (!pending) {
    pending = parseWavFile(toneFile(name)).then((buffer) => ({
      audioData: buffer.audioData,
      sampleRate: buffer.header.sampleRate,
    }));
    decoded.set(name, pending);
  }
  return pending;
}

/** Samples only, for the common case where the rate is already known from the manifest. */
export async function loadSamples(name: string): Promise<Float32Array> {
  return (await loadTone(name)).audioData;
}
