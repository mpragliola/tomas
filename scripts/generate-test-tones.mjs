/**
 * Generates the WAV fixtures under tests/fixtures/tones/.
 *
 * Run once, commit the result: `npm run fixtures:generate`. The tests read the files,
 * they never call this — so a change to the generator cannot silently change what the
 * tests are measuring, and the fixtures are real audio a human can open in an editor and
 * listen to when a DSP test starts failing for reasons nobody understands.
 *
 * Everything is 48 kHz and deterministic (a fixed LCG, no Math.random), so re-running
 * this on any machine reproduces byte-identical files.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import FFT from 'fft.js';
import { cabCurveDb, targetCurveDb } from '../tests/fixtures/curves.mjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'tones');
const RATE = 48000;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Numerical Recipes LCG — small, fast, identical on every platform. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296 - 0.5; // uniform in [-0.5, 0.5)
  };
}

const samples = (seconds, rate = RATE) => Math.round(seconds * rate);

function sine(frequency, seconds, amplitude = 0.5, rate = RATE) {
  const out = new Float32Array(samples(seconds, rate));
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / rate);
  }
  return out;
}

/** Sum of equal-amplitude sines — several simultaneous peaks to resolve. */
function multiSine(frequencies, seconds, amplitude = 0.5) {
  const out = new Float32Array(samples(seconds));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (const frequency of frequencies) sum += Math.sin((2 * Math.PI * frequency * i) / RATE);
    out[i] = sum;
  }
  return scaleToPeak(out, amplitude);
}

/** Fundamental plus harmonics at 1/n amplitude — an instrument-like line spectrum. */
function harmonicTone(fundamental, partials, seconds, amplitude = 0.5) {
  const out = new Float32Array(samples(seconds));
  for (let n = 1; n <= partials; n++) {
    const frequency = fundamental * n;
    if (frequency >= RATE / 2) break; // never generate a partial that would alias
    for (let i = 0; i < out.length; i++) {
      out[i] += Math.sin((2 * Math.PI * frequency * i) / RATE) / n;
    }
  }
  return scaleToPeak(out, amplitude);
}

/** Square wave built from its odd harmonics, so the fixture itself does not alias. */
function squareWave(frequency, seconds, amplitude = 0.5) {
  const out = new Float32Array(samples(seconds));
  for (let n = 1; frequency * n < RATE / 2; n += 2) {
    for (let i = 0; i < out.length; i++) {
      out[i] += Math.sin((2 * Math.PI * frequency * n * i) / RATE) / n;
    }
  }
  return scaleToPeak(out, amplitude);
}

function linearSweep(startHz, endHz, seconds, amplitude = 0.5) {
  const out = new Float32Array(samples(seconds));
  const rate = (endHz - startHz) / seconds;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    out[i] = amplitude * Math.sin(2 * Math.PI * (startHz * t + (rate * t * t) / 2));
  }
  return fadeEdges(out, samples(0.01));
}

/**
 * Exponential ("log") sine sweep — the standard measurement stimulus. Constant energy per
 * octave rather than per Hz, so the low end gets more than the handful of bins a linear
 * sweep leaves it.
 */
function logSweep(startHz, endHz, seconds, amplitude = 0.5) {
  const out = new Float32Array(samples(seconds));
  const ratio = Math.log(endHz / startHz);
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    out[i] =
      amplitude *
      Math.sin(((2 * Math.PI * startHz * seconds) / ratio) * (Math.exp((t / seconds) * ratio) - 1));
  }
  return fadeEdges(out, samples(0.01));
}

function whiteNoise(seed, seconds, amplitude = 0.5) {
  const next = rng(seed);
  const out = new Float32Array(samples(seconds));
  for (let i = 0; i < out.length; i++) out[i] = next() * 2 * amplitude;
  return out;
}

/**
 * Pink noise via Paul Kellet's economical filter: -3 dB/octave, equal energy per octave.
 * Closer to real program material than white, and it puts real level in the low bands
 * where fractional-octave smoothing is thinnest.
 */
function pinkNoise(seed, seconds, amplitude = 0.5) {
  const next = rng(seed);
  const out = new Float32Array(samples(seconds));
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < out.length; i++) {
    const white = next() * 2;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
  }
  return scaleToPeak(out, amplitude);
}

function impulse(seconds, amplitude = 1) {
  const out = new Float32Array(samples(seconds));
  out[0] = amplitude;
  return out;
}

function dcOffset(seconds, level = 0.5) {
  return new Float32Array(samples(seconds)).fill(level);
}

/** Alternating +/- full scale: a tone exactly at Nyquist, which `sine` cannot produce. */
function nyquistTone(seconds, amplitude = 0.9) {
  const out = new Float32Array(samples(seconds));
  for (let i = 0; i < out.length; i++) out[i] = i % 2 === 0 ? amplitude : -amplitude;
  return out;
}

/** 1 kHz sine driven 12 dB into a hard clip — broadband, ugly, and not band-limited. */
function clippedTone(frequency, seconds, ceiling = 0.5) {
  const raw = sine(frequency, seconds, 1);
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = Math.max(-ceiling, Math.min(ceiling, raw[i] * 4));
  return out;
}

// ---------------------------------------------------------------------------
// Shapers
// ---------------------------------------------------------------------------

/**
 * Wrap a signal in note-like bursts of varying level.
 *
 * Real playing is not stationary, and the noise-floor estimator depends on that: it finds
 * the floor in the quiet moments between notes. Steady material gives it nothing to work
 * with, so a fixture meant to exercise the SNR gate has to be shaped like this.
 */
function notes(signal, seed, noteSeconds = 0.35) {
  const next = rng(seed);
  const out = new Float32Array(signal.length);
  const noteLength = Math.max(1, samples(noteSeconds));
  for (let start = 0; start < signal.length; start += noteLength) {
    const level = 0.35 + Math.abs(next()) * 1.3;
    const end = Math.min(signal.length, start + noteLength);
    for (let i = start; i < end; i++) {
      const t = (i - start) / noteLength;
      out[i] = signal[i] * level * Math.exp(-4 * t) * Math.min(1, t * 60);
    }
  }
  return out;
}

function mix(...signals) {
  const out = new Float32Array(Math.max(...signals.map((s) => s.length)));
  for (const signal of signals) {
    for (let i = 0; i < signal.length; i++) out[i] += signal[i];
  }
  return out;
}

function gainDb(signal, db) {
  const gain = Math.pow(10, db / 20);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] * gain;
  return out;
}

function scaleToPeak(signal, peak) {
  let max = 0;
  for (const value of signal) max = Math.max(max, Math.abs(value));
  if (max === 0) return signal;
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = (signal[i] * peak) / max;
  return out;
}

function rms(signal) {
  let sum = 0;
  for (const value of signal) sum += value * value;
  return Math.sqrt(sum / Math.max(1, signal.length));
}

/** Add stationary hiss at a given RMS level in dBFS — a synthetic noise floor. */
function withNoiseFloor(signal, seed, levelDb) {
  const hiss = whiteNoise(seed, signal.length / RATE, 1);
  const gain = Math.pow(10, levelDb / 20) / (rms(hiss) || 1);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] + hiss[i] * gain;
  return out;
}

/** Raised-cosine fade at both ends, so a sweep does not start on a step discontinuity. */
function fadeEdges(signal, fadeSamples) {
  const out = Float32Array.from(signal);
  const n = Math.min(fadeSamples, Math.floor(signal.length / 2));
  for (let i = 0; i < n; i++) {
    const gain = 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
    out[i] *= gain;
    out[out.length - 1 - i] *= gain;
  }
  return out;
}

/**
 * Apply a dB-vs-frequency curve exactly, in the frequency domain: zero phase, arbitrarily
 * steep. A fixture pair that asks "did the tone match reproduce this curve?" needs the
 * curve applied without approximation, or the test measures the shaper's error too.
 */
function applyCurveDb(signal, curveDb, rate = RATE) {
  let n = 1;
  while (n < signal.length) n *= 2;

  const padded = new Float32Array(n);
  padded.set(signal);

  const fft = new FFT(n);
  const spectrum = fft.createComplexArray();
  fft.realTransform(spectrum, padded);
  fft.completeSpectrum(spectrum);

  for (let k = 0; k <= n / 2; k++) {
    const gain = Math.pow(10, curveDb((k * rate) / n) / 20);
    spectrum[k * 2] *= gain;
    spectrum[k * 2 + 1] *= gain;
    if (k > 0 && k < n / 2) {
      // Keep the spectrum conjugate-symmetric or the inverse transform is not real.
      spectrum[(n - k) * 2] = spectrum[k * 2];
      spectrum[(n - k) * 2 + 1] = -spectrum[k * 2 + 1];
    }
  }

  const time = fft.createComplexArray();
  fft.inverseTransform(time, spectrum);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = time[i * 2];
  return out;
}

// ---------------------------------------------------------------------------
// WAV writer
// ---------------------------------------------------------------------------

function encodeWav(planes, { sampleRate = RATE, bitDepth = 16 } = {}) {
  const frames = planes[0].length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = planes.length * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');

  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM fmt chunk size
  buffer.writeUInt16LE(1, 20); // format 1 = uncompressed PCM
  buffer.writeUInt16LE(planes.length, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);

  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  // Full scale is 2^(bits-1); stop one LSB short of it so +1.0 does not wrap to -1.0.
  const full = Math.pow(2, bitDepth - 1);
  let position = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const plane of planes) {
      const clamped = Math.max(-1, Math.min(1, plane[frame]));
      const value = Math.max(-full, Math.min(full - 1, Math.round(clamped * full)));
      if (bitDepth === 16) {
        buffer.writeInt16LE(value, position);
      } else if (bitDepth === 24) {
        const unsigned = value < 0 ? value + 0x1000000 : value;
        buffer.writeUIntLE(unsigned, position, 3);
      } else {
        buffer.writeInt32LE(value, position);
      }
      position += bytesPerSample;
    }
  }

  return buffer;
}

// ---------------------------------------------------------------------------
// The fixtures
// ---------------------------------------------------------------------------

/**
 * `broadband` marks the tones with usable energy across most of the audible band. Only
 * those are meaningful for tone matching — a 1 kHz sine says nothing about 5 kHz.
 * `pairedWith`/`curve` record how a matched pair was made, so the tests can assert the
 * derived IR against the curve the fixture was actually shaped with.
 */
const FIXTURES = [
  {
    name: 'sine-1k',
    description: '1 kHz sine, -6 dBFS — single known peak at an exact level',
    make: () => [sine(1000, 1)],
  },
  {
    name: 'chord-a-major',
    description: 'A3 major triad (220 / 277.18 / 329.63 Hz) — three simultaneous peaks',
    make: () => [multiSine([220, 277.18, 329.63], 1)],
  },
  {
    name: 'harmonic-e2',
    description: 'E2 (82.41 Hz) with 12 harmonics — instrument-like line spectrum',
    make: () => [harmonicTone(82.41, 12, 1)],
  },
  {
    name: 'square-500',
    description: '500 Hz band-limited square — odd harmonics only, no aliasing',
    make: () => [squareWave(500, 1)],
  },
  {
    name: 'sweep-log-20-20k',
    description: 'Exponential sweep 20 Hz to 20 kHz over 2 s — equal energy per octave',
    broadband: true,
    make: () => [logSweep(20, 20000, 2)],
  },
  {
    name: 'sweep-linear-100-8k',
    description: 'Linear sweep 100 Hz to 8 kHz over 2 s — equal energy per Hz',
    broadband: true,
    make: () => [linearSweep(100, 8000, 2)],
  },
  {
    name: 'white-noise',
    description: 'Flat stationary noise, 2 s — every bin excited, no quiet moments',
    broadband: true,
    make: () => [whiteNoise(1, 2)],
  },
  {
    name: 'pink-noise',
    description: 'Pink noise (-3 dB/octave), 2 s — real level in the low bands',
    broadband: true,
    make: () => [pinkNoise(2, 2)],
  },
  {
    name: 'white-noise-eq',
    description: 'white-noise through targetCurveDb — the reference take for an exact match',
    broadband: true,
    pairedWith: 'white-noise',
    curve: 'target',
    make: () => [applyCurveDb(whiteNoise(1, 2), targetCurveDb)],
  },
  {
    name: 'cab-noise',
    description: 'Pink noise through a guitar-cab curve, 4 s — band-limited program material',
    broadband: true,
    make: () => [applyCurveDb(pinkNoise(3, 4), cabCurveDb)],
  },
  {
    name: 'cab-noise-eq',
    description: 'cab-noise plus targetCurveDb — the reference take for the cab-noise pair',
    broadband: true,
    pairedWith: 'cab-noise',
    curve: 'target',
    make: () => [applyCurveDb(pinkNoise(3, 4), (f) => cabCurveDb(f) + targetCurveDb(f))],
  },
  {
    name: 'cab-noise-44100',
    description:
      'Cab + target curve at 44.1 kHz — a reference take whose bins sit at different frequencies from the working take, so matching by bin index would skew the whole curve',
    broadband: true,
    sampleRate: 44100,
    pairedWith: 'cab-noise',
    curve: 'target',
    make: () => [
      applyCurveDb(pinkNoise(3, 4), (f) => cabCurveDb(f) + targetCurveDb(f), 44100),
    ],
  },
  {
    name: 'mixed-program',
    description:
      'Note-shaped cab noise plus a quiet pink bed and a 110 Hz harmonic line, 4 s — non-stationary, so the noise-floor estimator has quiet moments to measure',
    broadband: true,
    make: () => [mixedProgram(4, 7)],
  },
  {
    name: 'mixed-program-eq',
    description: 'mixed-program through targetCurveDb — reference take on realistic material',
    broadband: true,
    pairedWith: 'mixed-program',
    curve: 'target',
    make: () => [applyCurveDb(mixedProgram(4, 7), targetCurveDb)],
  },
  {
    name: 'mixed-program-quiet-hiss',
    description: 'mixed-program with a -65 dBFS hiss floor added',
    broadband: true,
    make: () => [withNoiseFloor(mixedProgram(4, 7), 101, -65)],
  },
  {
    name: 'mixed-program-loud-hiss',
    description:
      'The same program material as mixed-program-quiet-hiss, sample for sample, but 23 dB hissier (-42 dBFS). Only the noise floor differs, so the honest tone match between the two is flat and any correction is the gate failing.',
    broadband: true,
    pairedWith: 'mixed-program-quiet-hiss',
    curve: 'flat',
    make: () => [withNoiseFloor(mixedProgram(4, 7), 202, -42)],
  },
  {
    name: 'impulse',
    description: 'Single full-scale sample then silence — flat spectrum, convolution identity',
    make: () => [impulse(0.25)],
  },
  {
    name: 'clipped-1k',
    description: '1 kHz sine driven 12 dB into a hard clip — broadband and badly behaved',
    make: () => [clippedTone(1000, 1)],
  },
  {
    name: 'silence',
    description: 'All zeros — nothing downstream may divide by it',
    make: () => [new Float32Array(samples(0.25))],
  },
  {
    name: 'dc-offset',
    description: 'Constant +0.5 — energy only in the DC bin',
    make: () => [dcOffset(0.25)],
  },
  {
    name: 'nyquist',
    description: 'Alternating +/- 0.9 — energy only at Nyquist',
    make: () => [nyquistTone(0.25)],
  },
  {
    name: 'sine-1k-24bit',
    description: '1 kHz sine at 24-bit — parser depth coverage',
    bitDepth: 24,
    make: () => [sine(1000, 0.25)],
  },
  {
    name: 'sine-1k-32bit',
    description: '1 kHz sine at 32-bit — parser depth coverage',
    bitDepth: 32,
    make: () => [sine(1000, 0.25)],
  },
  {
    name: 'sine-stereo',
    description:
      '1 kHz left / 440 Hz right — the mono mix must be the average of the two, not one channel',
    make: () => [sine(1000, 0.25), sine(440, 0.25)],
  },
];

/** Cab-shaped noise played in notes, over a quiet bed, with a harmonic line on top. */
function mixedProgram(seconds, seed) {
  return mix(
    // White rather than pink under the cab curve: pink's own -3 dB/octave stacks on the
    // cab rolloff and leaves the top two octaves with nothing above the hiss, which turns
    // every SNR-gated test into a test of the gate's disabled path.
    notes(applyCurveDb(whiteNoise(seed, seconds), (f) => cabCurveDb(f, 8500)), seed + 1),
    // A room-tone bed, kept quiet: real playing measures 15-20 dB of SNR against its own
    // floor, and a louder bed would push the fixture below the point where the SNR gate
    // trusts its own noise-floor estimate at all.
    gainDb(pinkNoise(seed + 2, seconds), -45),
    gainDb(notes(harmonicTone(110, 10, seconds), seed + 3), -6),
  );
}

mkdirSync(OUT_DIR, { recursive: true });

const manifest = FIXTURES.map((fixture) => {
  const planes = fixture.make();
  const sampleRate = fixture.sampleRate ?? RATE;
  const bitDepth = fixture.bitDepth ?? 16;
  const file = `${fixture.name}.wav`;

  writeFileSync(join(OUT_DIR, file), encodeWav(planes, { sampleRate, bitDepth }));

  return {
    name: fixture.name,
    file,
    description: fixture.description,
    sampleRate,
    bitDepth,
    channels: planes.length,
    frames: planes[0].length,
    seconds: Number((planes[0].length / sampleRate).toFixed(6)),
    broadband: Boolean(fixture.broadband),
    ...(fixture.pairedWith ? { pairedWith: fixture.pairedWith, curve: fixture.curve } : {}),
  };
});

writeFileSync(
  join(OUT_DIR, 'manifest.json'),
  JSON.stringify(
    {
      generatedBy: 'scripts/generate-test-tones.mjs',
      note: 'Do not edit by hand — run `npm run fixtures:generate`.',
      tones: manifest,
    },
    null,
    2,
  ) + '\n',
);

const bytes = manifest.reduce((sum, t) => sum + (t.frames * t.channels * t.bitDepth) / 8, 0);
console.log(`Wrote ${manifest.length} fixtures to ${OUT_DIR} (${(bytes / 1e6).toFixed(1)} MB)`);
