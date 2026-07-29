import FFT from 'fft.js';
import type { FFTConfig, FFTResult } from '../../types/spectrum';
import { logger } from '../logging';
import { hannWindow, hammingWindow } from './audioUtils';

export function computeFFT(signal: Float32Array, config: FFTConfig, sampleRate: number = 44100): FFTResult {
  logger.debug('fftProcessor', 'Computing FFT', {
    fftSize: config.fftSize,
    signalLength: signal.length,
    window: config.window,
    sampleRate,
  });

  const fft = new FFT(config.fftSize);
  const windowed = applyWindow(signal, config.fftSize, config.window);

  // realTransform expects a *real* input array — passing an interleaved complex
  // array would zero-stuff the signal and alias the spectrum.
  const spectrum = fft.createComplexArray();
  fft.realTransform(spectrum, windowed);

  // Extract magnitude and phase
  const magnitudes = new Float32Array(config.fftSize / 2);
  const phases = new Float32Array(config.fftSize / 2);

  for (let i = 0; i < config.fftSize / 2; i++) {
    const real = spectrum[i * 2];
    const imag = spectrum[i * 2 + 1];
    magnitudes[i] = Math.sqrt(real * real + imag * imag) / (config.fftSize / 2);
    phases[i] = Math.atan2(imag, real);
  }

  // Generate frequency array using actual sample rate
  const frequencies = new Float32Array(config.fftSize / 2);
  for (let i = 0; i < config.fftSize / 2; i++) {
    frequencies[i] = (i * sampleRate) / config.fftSize;
  }

  // Loop rather than Math.max(...magnitudes): the spread passes one argument per bin, and
  // at the offline 16384 that is 8192 arguments through a call that has an engine limit.
  let maxMagnitude = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    if (magnitudes[i] > maxMagnitude) maxMagnitude = magnitudes[i];
  }

  logger.debug('fftProcessor', 'FFT computed', {
    bins: config.fftSize / 2,
    maxMagnitude,
  });

  return { magnitudes, phases, frequencies };
}

/**
 * One or more channels of the same take. A bare `Float32Array` is treated as mono.
 *
 * Multi-channel input is summed **incoherently** — power per channel, added — never as
 * `(L+R)/2`. See `channelPower` for why that distinction is the whole point.
 */
export type ChannelInput = Float32Array | Float32Array[];

function asChannels(input: ChannelInput): Float32Array[] {
  return Array.isArray(input) ? input : [input];
}

/**
 * Welch-averaged magnitude spectrum across the whole signal.
 *
 * `computeFFT` only ever looks at the first `fftSize` samples, which for a multi-minute
 * recording characterises a few milliseconds of audio. Tone matching needs the average
 * behaviour of the whole take, so this averages the power spectrum over overlapping frames.
 *
 * No phases are returned: an averaged magnitude has no meaningful phase. They used to come
 * back as a zero-filled array, which reads as a measurement rather than as an absence.
 */
export function computeAveragedFFT(
  input: ChannelInput,
  config: FFTConfig,
  sampleRate: number = 44100,
  maxFrames: number = 512,
): FFTResult {
  const { fftSize } = config;
  const channels = asChannels(input);
  const length = channels[0]?.length ?? 0;

  if (length < fftSize) {
    // One zero-padded frame is not an average of anything. Callers that care about
    // trustworthy results should reject the selection before getting here.
    logger.warn('fftProcessor', 'Signal shorter than one FFT frame — result is a single frame', {
      signalLength: length,
      fftSize,
    });
    return computeFFT(channels[0] ?? new Float32Array(), config, sampleRate);
  }

  const binCount = fftSize / 2;
  const hop = Math.max(1, Math.round(fftSize * (1 - config.overlap)));
  const totalFrames = Math.floor((length - fftSize) / hop) + 1;
  // Spread a bounded number of frames across the whole signal rather than analysing
  // only the first `maxFrames` of them.
  const stride = Math.max(1, Math.ceil(totalFrames / maxFrames));

  const frameStarts: number[] = [];
  for (let f = 0; f < totalFrames; f += stride) frameStarts.push(f * hop);

  const fft = new FFT(fftSize);
  const spectrum = fft.createComplexArray();
  const window = buildWindow(fftSize, config.window);
  const frame = new Float32Array(fftSize);
  const power = new Float64Array(binCount);

  frameStarts.forEach((start) => {
    channelPower(channels, fft, spectrum, frame, window, start, fftSize, binCount, power);
  });

  const frames = frameStarts.length;

  const magnitudes = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    magnitudes[i] = Math.sqrt(power[i] / frames) / binCount;
  }

  const frequencies = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    frequencies[i] = (i * sampleRate) / fftSize;
  }

  const noiseFloor = estimateNoiseFloor(channels, config, binCount);

  logger.debug('fftProcessor', 'Averaged FFT computed', {
    bins: binCount,
    frames,
    totalFrames,
    channels: channels.length,
    sampleRate,
    noiseFloorEstimated: noiseFloor !== undefined,
  });

  return { magnitudes, frequencies, noiseFloor };
}

/**
 * Accumulate one frame's power, summed across channels and divided by the channel count.
 *
 * **This is the stereo phase fix.** The obvious move — average the channels into mono and
 * transform once — is a *coherent* sum, so any inter-channel phase difference cancels
 * before the FFT ever runs. On a wide master (Haas widening, M/S processing, decorrelated
 * reverb) that carves comb notches straight into the magnitude spectrum, and no amount of
 * downstream care can tell them from real tone: the pipeline correctly discards
 * inter-*take* phase (§6) but had no defence against intra-take phase.
 *
 * Transforming each channel and adding |X|² is an *incoherent* sum. Phase cannot cancel
 * because it is discarded per channel, before the addition.
 *
 * Dividing by the channel count keeps a mono file and its dual-mono copy measuring
 * identically, so switching sources does not shift the level.
 */
function channelPower(
  channels: Float32Array[],
  fft: FFT,
  spectrum: number[],
  frame: Float32Array,
  window: Float32Array,
  start: number,
  frameSize: number,
  binCount: number,
  power: Float64Array,
): void {
  const channelCount = channels.length;

  for (let ch = 0; ch < channelCount; ch++) {
    const samples = channels[ch];
    for (let i = 0; i < frameSize; i++) {
      frame[i] = samples[start + i] * window[i];
    }

    fft.realTransform(spectrum, frame);

    for (let i = 0; i < binCount; i++) {
      const real = spectrum[i * 2];
      const imag = spectrum[i * 2 + 1];
      power[i] += (real * real + imag * imag) / channelCount;
    }
  }
}

/** Frame groups used for the minimum-statistics noise estimate. */
const NOISE_GROUPS = 8;

/**
 * Frame length for the noise estimate, as a fraction of the tone-analysis frame.
 *
 * The estimate needs to *see* the gaps in the performance. A 16384-point frame is 372 ms
 * at 44.1 kHz — long enough to straddle a whole note, so every frame contains signal and
 * the minimum never drops to the floor. Short frames resolve the envelope, so the quiet
 * moments between and after notes actually show up as minima. Frequency resolution barely
 * matters here: a noise floor is broadband and smooth by nature.
 */
const NOISE_FRAME_DIVISOR = 8;
const MIN_NOISE_FRAME = 512;

/**
 * Per-bin stationary noise floor, by minimum statistics.
 *
 * A bin's per-frame periodogram power is roughly exponentially distributed about the
 * true power in that bin. Program material comes and goes, so its bins dip far below
 * their own mean at some point during the take; a constant hiss floor never does. That
 * gap between "mean" and "quietest moment" is what separates signal from noise, and it
 * survives the case a level threshold cannot — hiss that is *louder* than the program in
 * the bands where the program has rolled off.
 *
 * For F independent Exp(mean m) samples the minimum is Exp(mean m/F), whose median is
 * (m/F)·ln2. So taking the median of the per-group minima and multiplying by F/ln2
 * recovers m. The median across groups keeps one freak-quiet frame from dominating.
 *
 * Overlapping frames are correlated, so F is not strictly the independent count — but
 * measured against stationary noise (whose true answer is 0 dB SNR) the uncorrected form
 * lands within a few tenths of a dB, so it is left alone. Per-bin spread is about
 * ±1.5 dB, which is what the gate downstream must tolerate.
 *
 * The result is returned on the caller's `binCount` grid. Returns undefined when there
 * are too few frames for the estimate to mean anything.
 */
function estimateNoiseFloor(
  channels: Float32Array[],
  config: FFTConfig,
  targetBinCount: number,
): Float32Array | undefined {
  const length = channels[0]?.length ?? 0;
  const frameSize = Math.max(
    MIN_NOISE_FRAME,
    Math.min(config.fftSize, config.fftSize / NOISE_FRAME_DIVISOR),
  );
  if (length < frameSize * 16) return undefined;

  const binCount = frameSize / 2;
  const hop = Math.max(1, Math.round(frameSize / 2));
  const totalFrames = Math.floor((length - frameSize) / hop) + 1;
  if (totalFrames < 16) return undefined;

  const stride = Math.max(1, Math.ceil(totalFrames / 4096));
  const starts: number[] = [];
  for (let f = 0; f < totalFrames; f += stride) starts.push(f * hop);

  const fft = new FFT(frameSize);
  const spectrum = fft.createComplexArray();
  const window = buildWindow(frameSize, config.window);
  const frame = new Float32Array(frameSize);

  const framesPerGroup = Math.ceil(starts.length / NOISE_GROUPS);
  const groupMinima = new Float64Array(NOISE_GROUPS * binCount).fill(Infinity);
  const groupSizes = new Int32Array(NOISE_GROUPS);
  // Same incoherent channel sum the signal gets. Measuring the floor on a mono mixdown
  // while the signal comes from a power sum would put a channel-dependent offset between
  // the two, and every SNR the gate in §5.4.3 depends on would inherit it.
  const framePower = new Float64Array(binCount);

  starts.forEach((start, index) => {
    framePower.fill(0);
    channelPower(channels, fft, spectrum, frame, window, start, frameSize, binCount, framePower);

    const group = Math.min(NOISE_GROUPS - 1, Math.floor(index / framesPerGroup));
    groupSizes[group]++;
    const groupOffset = group * binCount;

    for (let i = 0; i < binCount; i++) {
      if (framePower[i] < groupMinima[groupOffset + i]) {
        groupMinima[groupOffset + i] = framePower[i];
      }
    }
  });

  let usableGroups = 0;
  let usedFrames = 0;
  for (let g = 0; g < NOISE_GROUPS; g++) {
    if (groupSizes[g] >= 2) {
      usableGroups++;
      usedFrames += groupSizes[g];
    }
  }
  if (usableGroups < NOISE_GROUPS / 2) return undefined;

  const correction = Math.max(1, usedFrames / usableGroups) / Math.LN2;

  // Amplitude under this normalisation goes as 1/sqrt(frameSize), so a coarse-grid
  // estimate has to be scaled before it can be compared against the fine-grid spectrum.
  const gridScale = Math.sqrt(binCount / targetBinCount);

  const coarse = new Float32Array(binCount);
  const scratch: number[] = [];
  for (let i = 0; i < binCount; i++) {
    scratch.length = 0;
    for (let g = 0; g < NOISE_GROUPS; g++) {
      if (groupSizes[g] < 2) continue;
      const value = groupMinima[g * binCount + i];
      if (Number.isFinite(value)) scratch.push(value);
    }
    if (scratch.length === 0) {
      coarse[i] = 0;
      continue;
    }
    scratch.sort((a, b) => a - b);
    const middle = scratch.length >> 1;
    const median =
      scratch.length % 2 === 1 ? scratch[middle] : (scratch[middle - 1] + scratch[middle]) / 2;
    coarse[i] = (Math.sqrt(median * correction) / binCount) * gridScale;
  }

  if (binCount === targetBinCount) return coarse;

  // Stretch onto the caller's grid — both grids span DC to Nyquist.
  const out = new Float32Array(targetBinCount);
  const ratio = (binCount - 1) / (targetBinCount - 1);
  for (let i = 0; i < targetBinCount; i++) {
    const position = i * ratio;
    const index = Math.min(binCount - 2, Math.floor(position));
    const fraction = position - index;
    out[i] = coarse[index] + (coarse[index + 1] - coarse[index]) * fraction;
  }
  return out;
}

function buildWindow(
  length: number,
  windowType: 'hann' | 'hamming' | 'rectangular',
): Float32Array {
  if (windowType === 'hann') return hannWindow(length);
  if (windowType === 'hamming') return hammingWindow(length);
  return new Float32Array(length).fill(1);
}

function applyWindow(
  signal: Float32Array,
  fftSize: number,
  windowType: 'hann' | 'hamming' | 'rectangular',
): Float32Array {
  const windowed = new Float32Array(fftSize);
  const windowSize = Math.min(signal.length, fftSize);
  const window = buildWindow(windowSize, windowType);

  for (let i = 0; i < windowSize; i++) {
    windowed[i] = (signal[i] || 0) * window[i];
  }

  return windowed;
}
