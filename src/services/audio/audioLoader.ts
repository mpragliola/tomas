import type { AudioBuffer } from '../../types/audio';
import { parseWavFile } from './wavParser';
import { decodeCompressedAudio } from './audioDecoder';

export const SUPPORTED_AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac'];

export function isSupportedAudioFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return SUPPORTED_AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function parseAudioFile(file: File): Promise<AudioBuffer> {
  if (file.name.toLowerCase().endsWith('.wav')) {
    return parseWavFile(file);
  }
  return decodeCompressedAudio(file);
}
