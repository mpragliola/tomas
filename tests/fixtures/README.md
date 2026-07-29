# Test tone fixtures

`tones/` holds pre-generated 48 kHz WAV files used by the test suite. They are committed
audio, not built at test time: `scripts/generate-test-tones.mjs` writes them and nothing
else does.

Two reasons for that. A failing DSP assertion is then unambiguous — the input did not
change, so the code did. And every fixture can be opened in an audio editor and listened
to, which is the fastest way to understand a spectrum test that has started disagreeing
with you.

## Regenerating

```bash
npm run fixtures:generate
```

Deterministic: same generator, byte-identical files. If a regeneration produces a diff,
the generator changed and every threshold in the suite should be re-checked before the new
files are committed.

## Using them

```ts
import { loadSamples, toneFile, TONES } from '../fixtures';

const samples = await loadSamples('cab-noise'); // mono Float32Array via the app's parser
const file = toneFile('cab-noise');             // the File a picker would hand the app
```

`tones/manifest.json` describes every fixture (rate, depth, channels, length, whether it is
broadband, and which take it is paired with). `TONES` is that manifest, typed.

## The bench

| Fixture | What it is for |
| --- | --- |
| `sine-1k`, `chord-a-major`, `harmonic-e2`, `square-500` | Line spectra with known peaks — bin layout, peak picking, resolution |
| `sweep-log-20-20k`, `sweep-linear-100-8k` | Every bin excited, but only briefly — separates a whole-take average from a single frame |
| `white-noise`, `pink-noise` | Stationary broadband; flat and -3 dB/octave respectively |
| `cab-noise`, `cab-noise-eq`, `cab-noise-44100` | Band-limited program material and its EQ'd reference — the second at 44.1 kHz, for the sample-rate mismatch path |
| `mixed-program`, `mixed-program-eq` | Note-shaped material with a room-tone bed: non-stationary, so the noise-floor estimator has quiet moments to measure |
| `mixed-program-quiet-hiss`, `mixed-program-loud-hiss` | Identical tone, floors 23 dB apart — a noise-floor difference must not be matched as a tone difference |
| `impulse`, `silence`, `dc-offset`, `nyquist`, `clipped-1k` | Degenerate inputs that must not produce NaN, Infinity or a crash |
| `sine-1k-24bit`, `sine-1k-32bit`, `sine-stereo` | Parser coverage: bit depths and stereo-to-mono |

The `*-eq` takes are the same audio with `targetCurveDb` from `curves.mjs` applied, so the
tone match has a known right answer rather than an approximate one. `curves.mjs` is shared
by the generator and the tests for exactly that reason — the expected value cannot drift
from what was baked into the file.
