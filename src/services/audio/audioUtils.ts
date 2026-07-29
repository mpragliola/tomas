// Periodic (DFT-even) form — divisor is `length`, not `length - 1`. The symmetric form
// is for filter design; for spectral analysis it biases the window by one sample and
// breaks constant-overlap-add.
export function hannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
  }
  return window;
}

export function hammingWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / length);
  }
  return window;
}

export function normalizeAudio(signal: Float32Array): Float32Array {
  let max = 0;
  for (let i = 0; i < signal.length; i++) {
    const magnitude = Math.abs(signal[i]);
    if (magnitude > max) max = magnitude;
  }
  if (max === 0) return signal;

  const normalized = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    normalized[i] = signal[i] / max;
  }
  return normalized;
}

// A linear-interpolation `resample` used to live here, used only to convert the IR between
// 44.1 and 48 kHz on export. It was removed rather than improved: linear interpolation is
// a triangular kernel, so it lowpasses by sinc²(f·T) — 6.3 dB down at 20 kHz — and an
// impulse response has real content right up to Nyquist. The export path now renders a
// fresh minimum-phase filter at the target rate from the tone curve instead
// (`renderToneMatchIR`), which is both exact and cheaper than a proper polyphase resampler
// would have been.
