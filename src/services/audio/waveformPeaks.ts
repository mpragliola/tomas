/**
 * Bucketed min/max decimation for waveform display. WaveSurfer's own renderer buckets
 * whatever `peaks` array it is given into per-pixel min/max on every render and zoom
 * change — handing it the full decoded sample array makes that a multi-million-point
 * pass on the main thread every time. Pre-decimating once at load time, emitting both
 * the min and max of each bucket (not a naive subsample), keeps transient shape while
 * cutting the array WaveSurfer has to rebucket down to `targetPoints`.
 */
export function computeWavePeaks(
  audioData: Float32Array<ArrayBuffer>,
  targetPoints = 20_000,
): Float32Array<ArrayBuffer> {
  const length = audioData.length;
  if (length === 0) return new Float32Array();

  const buckets = Math.max(1, Math.floor(targetPoints / 2));
  if (buckets >= length) return audioData.slice();

  const peaks = new Float32Array(buckets * 2);
  const bucketSize = length / buckets;

  for (let i = 0; i < buckets; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(length, Math.floor((i + 1) * bucketSize));

    let min = audioData[start];
    let max = audioData[start];
    for (let j = start + 1; j < end; j++) {
      const sample = audioData[j];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }

    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }

  return peaks;
}
