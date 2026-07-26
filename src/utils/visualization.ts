export interface ColorMap {
  min: string;
  max: string;
}

export function linearToLogScale(value: number, min: number, max: number): number {
  throw new Error('Not implemented');
}

export function getColorForValue(value: number, colorMap: ColorMap): string {
  throw new Error('Not implemented');
}

export function normalizeFrequencyRange(freq: number, minFreq: number, maxFreq: number): number {
  throw new Error('Not implemented');
}
