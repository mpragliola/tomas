export function toDb(linear: number, refLevel: number = 1.0): number {
  const clamped = Math.max(linear, 1e-10);
  return 20 * Math.log10(clamped / refLevel);
}

export function toLinear(db: number, refLevel: number = 1.0): number {
  return refLevel * Math.pow(10, db / 20);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function frequencyToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

export function melToFrequency(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

export function rms(signal: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < signal.length; i++) {
    sum += signal[i] * signal[i];
  }
  return Math.sqrt(sum / signal.length);
}

export function peak(signal: Float32Array): number {
  let max = 0;
  for (let i = 0; i < signal.length; i++) {
    max = Math.max(max, Math.abs(signal[i]));
  }
  return max;
}
