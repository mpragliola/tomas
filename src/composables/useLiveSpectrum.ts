import { shallowRef, watch, onUnmounted } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { LIVE_ANALYSER_DB_OFFSET } from '../services/dsp/defaults';
import { logger } from '../services/logging';

/**
 * Points on the drawn curve. The analyser hands back 2048 linear bins, which on a log
 * axis crowd everything above 1 kHz into pixel mush and cost a full redraw per frame.
 * 192 log-spaced points look identical and keep the per-frame restyle cheap.
 */
const CURVE_POINTS = 192;

/** Below this the plot is off the bottom of the useful range anyway. */
const FLOOR_DB = -140;

/** Lowest frequency drawn — the offline spectra start here too. */
const MIN_FREQ = 20;

/** ~25 fps. rAF rate buys nothing visible on a smoothed spectrum and triples the redraws. */
const FRAME_INTERVAL_MS = 40;

/**
 * Time constant of the running average, in seconds — the classic RTA "slow" setting.
 * Long enough that the line stops chasing individual notes and reads as tonal balance,
 * short enough that it still follows a change of section rather than freezing into the
 * average of the whole take.
 */
const AVERAGE_TAU_SEC = 1.5;

/**
 * Loudest point a frame can reach and still count as silence. Below this the frame is
 * not folded in at all: between phrases the true energy average sinks towards the floor,
 * which is honest but reads as the curve dying. Freezing instead holds the last balance
 * until the music comes back.
 */
const SILENCE_GATE_DB = -70;

interface Bucket {
  /** First analyser bin in this bucket. */
  start: number;
  /** One past the last analyser bin in this bucket. */
  end: number;
  /**
   * Bin position of the bucket's centre frequency, fractional. Used instead of the
   * range whenever the bucket is narrower than a bin — see `sampleBucket`.
   */
  centre: number;
}

/**
 * Log-spaced buckets over the analyser's linear bins, precomputed once per take:
 * the mapping only depends on the bin count and the bin width, which do not change
 * while a source is sounding.
 */
function buildBuckets(binCount: number, binHz: number): { frequencies: number[]; buckets: Bucket[] } {
  const nyquist = binCount * binHz;
  const minFreq = Math.max(MIN_FREQ, binHz);
  const frequencies: number[] = [];
  const buckets: Bucket[] = [];

  if (nyquist <= minFreq) return { frequencies, buckets };

  const decades = Math.log(nyquist / minFreq);

  for (let point = 0; point < CURVE_POINTS; point++) {
    const low = minFreq * Math.exp(decades * (point / CURVE_POINTS));
    const high = minFreq * Math.exp(decades * ((point + 1) / CURVE_POINTS));

    // Down at 20 Hz a bucket is narrower than one bin, so the range would come out
    // empty — widen it to a single bin rather than dropping the point.
    const start = Math.min(Math.round(low / binHz), binCount - 1);
    const end = Math.min(Math.max(Math.round(high / binHz), start + 1), binCount);

    // Geometric centre, so the point sits where the bucket looks centred on a log axis
    const centreFreq = Math.sqrt(low * high);
    frequencies.push(centreFreq);
    buckets.push({
      start,
      end,
      centre: Math.min(centreFreq / binHz, binCount - 1),
    });
  }

  return { frequencies, buckets };
}

/**
 * One point of the curve.
 *
 * Above a few hundred Hz a bucket covers many bins and the peak across them is what
 * matters — averaging buries narrow content that is plainly audible. Down at the bottom
 * the opposite is true: several buckets fall inside a single 10.8 Hz bin, and taking
 * that bin's value for each of them draws the low end as a staircase. There the value
 * is interpolated between the neighbouring bins at the bucket's exact centre, which
 * turns the same data into a smooth slope.
 */
function sampleBucket(bins: Float32Array, bucket: Bucket): number {
  if (bucket.end - bucket.start > 1) {
    let peak = FLOOR_DB;
    for (let bin = bucket.start; bin < bucket.end; bin++) {
      if (bins[bin] > peak) peak = bins[bin];
    }
    return peak;
  }

  const lower = Math.floor(bucket.centre);
  const upper = Math.min(lower + 1, bins.length - 1);
  const weight = bucket.centre - lower;

  // Interpolating in dB, not in linear magnitude: the axis is logarithmic, so a straight
  // line between two decibel values is the straight line the eye expects to see.
  const a = Number.isFinite(bins[lower]) ? bins[lower] : FLOOR_DB;
  const b = Number.isFinite(bins[upper]) ? bins[upper] : FLOOR_DB;
  return a + (b - a) * weight;
}

/**
 * The moving spectrum of whatever the transport is playing, ready to plot.
 *
 * All three refs are null whenever nothing is sounding, so a caller can treat "is there a
 * live curve" and "here is the data" as the same question. `frequencies` is stable for
 * the whole take; `magnitudesDb` and `averageDb` are replaced (not mutated) each frame so
 * watchers fire. `averageDb` is the same curve run through a running average, which is
 * the quantity the static spectra on the same plot show — they are Welch averages of a
 * whole selection, so only a time-averaged live curve is comparable to them by eye.
 */
export function useLiveSpectrum() {
  const store = useAnalysisStore();
  const frequencies = shallowRef<number[] | null>(null);
  const magnitudesDb = shallowRef<Float32Array | null>(null);
  const averageDb = shallowRef<Float32Array | null>(null);

  let animationFrameId: number | null = null;
  // Explicit ArrayBuffer, not the ArrayBufferLike default: `getFloatFrequencyData` will
  // not take a view that might be over shared memory.
  let bins: Float32Array<ArrayBuffer> | null = null;
  /** Scratch for the second and later channels, so a frame allocates nothing. */
  let channelBins: Float32Array<ArrayBuffer> | null = null;
  let buckets: Bucket[] = [];
  let lastFrameAt = 0;

  /**
   * Running average per point, kept as linear power rather than dB. Averaging the decibel
   * values instead would be a geometric mean, which reads several dB below the Welch
   * average of the same material — the two curves would never line up.
   */
  let averagePower: Float64Array | null = null;
  /** Whether the average holds a frame yet, or is still waiting to be seeded from one. */
  let averageSeeded = false;

  function stop(): void {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    bins = null;
    channelBins = null;
    buckets = [];
    averagePower = null;
    averageSeeded = false;
    frequencies.value = null;
    magnitudesDb.value = null;
    averageDb.value = null;
  }

  /**
   * One frame of the whole take, channels summed incoherently.
   *
   * Same sum `channelPower` performs offline, and for the same reason: averaging the
   * channels into one signal first is a coherent sum, so any inter-channel phase
   * difference carves notches into the curve that are not tone. The static spectra on the
   * plot are measured this way, so the live one has to be as well or they cannot be read
   * against each other.
   */
  function readCombined(
    nodes: AnalyserNode[],
    target: Float32Array<ArrayBuffer>,
    scratch: Float32Array<ArrayBuffer>,
  ): void {
    nodes[0].getFloatFrequencyData(target);
    if (nodes.length === 1) return;

    for (let i = 0; i < target.length; i++) target[i] = 10 ** (target[i] / 10);

    for (let node = 1; node < nodes.length; node++) {
      nodes[node].getFloatFrequencyData(scratch);
      for (let i = 0; i < target.length; i++) target[i] += 10 ** (scratch[i] / 10);
    }

    for (let i = 0; i < target.length; i++) {
      target[i] = 10 * Math.log10(target[i] / nodes.length);
    }
  }

  function start(nodes: AnalyserNode[], previousBucketCount = 0): void {
    const [analyser] = nodes;
    const binCount = analyser.frequencyBinCount;
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    const layout = buildBuckets(binCount, binHz);

    if (layout.buckets.length === 0) {
      logger.warn('LiveSpectrum', 'No usable bins for the live curve', { binCount, binHz });
      return;
    }

    bins = new Float32Array(binCount);
    channelBins = nodes.length > 1 ? new Float32Array(binCount) : null;
    buckets = layout.buckets;
    frequencies.value = layout.frequencies;
    lastFrameAt = 0;

    // Preserve average if bucket count unchanged (smooth transition across source changes)
    // Otherwise reset it for a new analysis
    if (previousBucketCount !== layout.buckets.length) {
      averagePower = new Float64Array(layout.buckets.length);
      averageSeeded = false;
    } else if (!averagePower) {
      averagePower = new Float64Array(layout.buckets.length);
    }

    const tick = (now: number) => {
      // The analysers are swapped out from under us on every stop and every source switch
      if (store.analysers !== nodes || !bins || !averagePower) {
        animationFrameId = null;
        return;
      }

      animationFrameId = requestAnimationFrame(tick);

      if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
      // First frame of a take has no previous timestamp to measure against, so it averages
      // nothing — it is the frame the average is seeded from instead.
      const elapsedMs = lastFrameAt === 0 ? 0 : now - lastFrameAt;
      lastFrameAt = now;

      readCombined(nodes, bins, channelBins ?? bins);

      const curve = new Float32Array(buckets.length);
      let loudest = FLOOR_DB;

      for (let point = 0; point < buckets.length; point++) {
        const value = sampleBucket(bins, buckets[point]);
        // Silence reads as -Infinity from the analyser, which Plotly cannot draw
        const level = Number.isFinite(value)
          ? Math.max(value + LIVE_ANALYSER_DB_OFFSET, FLOOR_DB)
          : FLOOR_DB;
        curve[point] = level;
        if (level > loudest) loudest = level;
      }

      // Weight from elapsed time rather than a fixed per-frame constant, so a dropped
      // frame does not quietly lengthen the time constant.
      const weight = averageSeeded ? 1 - Math.exp(-(elapsedMs / 1000) / AVERAGE_TAU_SEC) : 1;

      if (loudest > SILENCE_GATE_DB || !averageSeeded) {
        const smoothed = new Float32Array(buckets.length);

        for (let point = 0; point < buckets.length; point++) {
          // dB here is 10*log10(power), so this and its inverse below are the power form
          const power = 10 ** (curve[point] / 10);
          averagePower[point] += (power - averagePower[point]) * weight;
          smoothed[point] = Math.max(10 * Math.log10(averagePower[point]), FLOOR_DB);
        }

        averageSeeded = true;
        averageDb.value = smoothed;
      }

      magnitudesDb.value = curve;
    };

    animationFrameId = requestAnimationFrame(tick);
    logger.debug('LiveSpectrum', 'Live curve started', {
      binCount,
      binHz,
      points: buckets.length,
      channels: nodes.length,
    });
  }

  watch(
    () => store.analysers,
    (nodes) => {
      // Cancel animation frame but preserve spectrum curve for smooth source transitions
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      bins = null;
      channelBins = null;
      const previousBucketCount = buckets.length;
      buckets = [];

      if (nodes.length) start(nodes, previousBucketCount);
    },
    { immediate: true }
  );

  onUnmounted(stop);

  return { frequencies, magnitudesDb, averageDb };
}
