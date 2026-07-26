export function hannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  }
  return window;
}

export function hammingWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (length - 1));
  }
  return window;
}

export function normalizeAudio(signal: Float32Array): Float32Array {
  const max = Math.max(...Array.from(signal).map(Math.abs));
  if (max === 0) return signal;

  const normalized = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    normalized[i] = signal[i] / max;
  }
  return normalized;
}

export function resample(signal: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return signal;

  const ratio = toRate / fromRate;
  const newLength = Math.round(signal.length * ratio);
  const resampled = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i / ratio;
    const srcIndexInt = Math.floor(srcIndex);
    const srcIndexFrac = srcIndex - srcIndexInt;

    if (srcIndexInt >= signal.length - 1) {
      resampled[i] = signal[signal.length - 1];
    } else {
      const s0 = signal[srcIndexInt];
      const s1 = signal[srcIndexInt + 1];
      resampled[i] = s0 + (s1 - s0) * srcIndexFrac;
    }
  }

  return resampled;
}
