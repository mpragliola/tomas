export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 8-bit is deliberately absent. Its LSB sits at -42 dBFS, and a tone-match IR peaks around
 * 0.05-0.3, so the usable resolution is 22-26 dB — the quantization error would be a larger
 * filter than the correction itself.
 */
export type PcmBitDepth = 16 | 24;

/** What the export dropdown offers: integer PCM depths plus IEEE float. */
export type ExportFormat = PcmBitDepth | 'float32';

/**
 * Encode mono samples as integer PCM (format tag 1), the format hardware IR loaders expect.
 * Signed little-endian at both supported depths.
 *
 * `dither` defaults on for 16-bit and off for 24-bit — see `tpdfNoise` for why an impulse
 * response in particular needs it.
 */
export function encodeWavPcm(
  samples: Float32Array,
  sampleRate: number,
  bitDepth: PcmBitDepth,
  dither: boolean = bitDepth < 24,
): ArrayBuffer {
  const numChannels = 1;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // 1 = integer PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const maxValue = Math.pow(2, bitDepth - 1) - 1;
  const limit = Math.pow(2, bitDepth - 1) - 1;
  let offset = 44;

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const scaled = clamped * maxValue + (dither ? tpdfNoise() : 0);
    // Dither can push a full-scale sample past the last code — clamp in integer units,
    // after the noise, or a +1.0 tap wraps to the largest negative value.
    const value = Math.max(-limit - 1, Math.min(limit, Math.round(scaled)));

    if (bitDepth === 16) {
      view.setInt16(offset, value, true);
    } else {
      // 24-bit: three little-endian bytes of the two's-complement value
      const unsigned = value < 0 ? value + 0x1000000 : value;
      view.setUint8(offset, unsigned & 0xff);
      view.setUint8(offset + 1, (unsigned >> 8) & 0xff);
      view.setUint8(offset + 2, (unsigned >> 16) & 0xff);
    }
    offset += bytesPerSample;
  }

  return buffer;
}

/**
 * Triangular-PDF dither, ±1 LSB, as the difference of two uniform draws.
 *
 * Why an IR needs this more than program material does. A minimum-phase filter puts its
 * low-frequency information in a long, quietly decaying tail. Round that tail without
 * dither and every sample below half an LSB becomes exactly zero — not noisy, *gone* —
 * so the filter loses the part that resolves the bass and gains a hard truncation where
 * the tail used to be. TPDF makes the error zero-mean and signal-independent, which keeps
 * the sub-LSB tail alive statistically: the average of the quantized tail still tracks the
 * real one.
 *
 * Triangular rather than rectangular because it also removes the *modulation* of the error
 * by the signal, which is what would otherwise turn a decaying tail into a correlated
 * artefact rather than plain noise.
 */
function tpdfNoise(): number {
  return Math.random() - Math.random();
}

/** Encode mono samples as a 32-bit float WAV (format tag 3, IEEE float). */
export function encodeWavFloat32(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 32;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // 3 = IEEE float, must match the 32-bit float samples below
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i++) {
    view.setFloat32(44 + i * 4, samples[i], true);
  }

  return buffer;
}

export function downloadFile(data: ArrayBuffer, filename: string, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
