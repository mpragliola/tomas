export interface ColorMap {
  min: string;
  max: string;
}

export function linearToLogScale(value: number, min: number, max: number): number {
  if (value <= 0) return 0;
  const logMin = Math.log10(Math.max(min, 1e-10));
  const logMax = Math.log10(Math.max(max, 1e-10));
  const logValue = Math.log10(value);
  return (logValue - logMin) / (logMax - logMin);
}

export function normalizeFrequencyRange(freq: number, minFreq: number, maxFreq: number): number {
  if (minFreq <= 0) return (freq - 1) / (maxFreq - 1);
  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);
  const logFreq = Math.log10(Math.max(freq, 1));
  return (logFreq - logMin) / (logMax - logMin);
}

export function getColorForValue(value: number, colorMap: ColorMap): string {
  // Interpolate between two colors (hex strings)
  // value should be 0-1
  const clamped = Math.max(0, Math.min(1, value));
  const minRgb = hexToRgb(colorMap.min);
  const maxRgb = hexToRgb(colorMap.max);

  if (!minRgb || !maxRgb) return colorMap.min;

  const r = Math.round(minRgb.r + (maxRgb.r - minRgb.r) * clamped);
  const g = Math.round(minRgb.g + (maxRgb.g - minRgb.g) * clamped);
  const b = Math.round(minRgb.b + (maxRgb.b - minRgb.b) * clamped);

  return `rgb(${r}, ${g}, ${b})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    }
    : null;
}
