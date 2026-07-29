import { describe, it, expect } from 'vitest';
import { parseWavFile } from '../../../src/services/audio/wavParser';
import { TONES, toneBytes, toneFile, toneInfo } from '../../fixtures';

/**
 * Runs against the committed WAV fixtures in tests/fixtures/tones — real files with real
 * headers, so the parser is tested on the same bytes the app receives from a file picker.
 */

describe('wavParser', () => {
  it('parses the header of every fixture as generated', async () => {
    for (const fixture of TONES) {
      const parsed = await parseWavFile(toneFile(fixture.name));

      expect(parsed.header.sampleRate, fixture.name).toBe(fixture.sampleRate);
      expect(parsed.header.bitDepth, fixture.name).toBe(fixture.bitDepth);
      expect(parsed.header.duration, fixture.name).toBeCloseTo(fixture.seconds, 4);
      // Always mono out, whatever went in.
      expect(parsed.header.channels, fixture.name).toBe(1);
      expect(parsed.audioData.length, fixture.name).toBe(fixture.frames);
    }
  });

  it('extracts audio data that round-trips to the original samples', async () => {
    // 1 kHz at -6 dBFS: sample i is 0.5 * sin(2*pi*1000*i/48000), known exactly.
    const { sampleRate } = toneInfo('sine-1k');
    const parsed = await parseWavFile(toneFile('sine-1k'));

    for (let i = 0; i < parsed.audioData.length; i += 137) {
      const expected = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
      // 16-bit quantisation is 1/32768, so three decimals is a real bound, not a shrug.
      expect(parsed.audioData[i]).toBeCloseTo(expected, 3);
    }
  });

  it('reads 24- and 32-bit files more accurately than 16-bit, not differently', async () => {
    const sixteen = await parseWavFile(toneFile('sine-1k'));
    const results = await Promise.all([
      parseWavFile(toneFile('sine-1k-24bit')),
      parseWavFile(toneFile('sine-1k-32bit')),
    ]);

    for (const parsed of results) {
      for (let i = 0; i < parsed.audioData.length; i += 97) {
        const expected = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
        expect(parsed.audioData[i]).toBeCloseTo(expected, 6);
        // ...and the same waveform the 16-bit file carried, within its coarser steps.
        expect(parsed.audioData[i]).toBeCloseTo(sixteen.audioData[i], 3);
      }
    }
  });

  it('mixes stereo to mono by averaging, not by picking a channel', async () => {
    // Left is 1 kHz, right is 440 Hz. A parser that kept one channel would match one of
    // the two sines exactly and the average not at all.
    const parsed = await parseWavFile(toneFile('sine-stereo'));

    expect(parsed.audioData.length).toBe(toneInfo('sine-stereo').frames);

    for (let i = 0; i < parsed.audioData.length; i += 89) {
      const left = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
      const right = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000);
      expect(parsed.audioData[i]).toBeCloseTo((left + right) / 2, 3);
    }
  });

  it('keeps the file\'s own sample rate rather than assuming 48 kHz', async () => {
    const parsed = await parseWavFile(toneFile('cab-noise-44100'));
    expect(parsed.header.sampleRate).toBe(44100);
  });

  it('rejects a non-PCM format tag', async () => {
    const bytes = toneBytes('sine-1k').slice();
    new DataView(bytes.buffer).setUint16(20, 3, true); // 3 = IEEE float, not supported

    await expect(parseWavFile(new File([bytes], 'float.wav'))).rejects.toThrow(/PCM/);
  });

  it('rejects an unsupported bit depth', async () => {
    const bytes = toneBytes('sine-1k').slice();
    new DataView(bytes.buffer).setUint16(34, 8, true); // 8-bit is unsigned PCM, not handled

    await expect(parseWavFile(new File([bytes], 'eight-bit.wav'))).rejects.toThrow(/bit depth/i);
  });

  it('rejects a file whose RIFF magic has been damaged', async () => {
    const bytes = toneBytes('sine-1k').slice();
    bytes[1] = 0x00;

    await expect(parseWavFile(new File([bytes], 'broken.wav'))).rejects.toThrow(/RIFF/);
  });
});
