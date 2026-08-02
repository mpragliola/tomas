# DSP Reference

Everything the app does to audio, why it does it, and the maths behind each step.

The product goal is one thing: **given a working take A and a reference take B, produce a
minimum-phase FIR that, loaded after A, makes A sound like B**. Every choice below exists
to make that curve honest — to correct tone and nothing else (not level, not noise, not
phase, not the bands where neither recording has anything to say).

---

## 1. Signal path

```
WAV / device capture
   ↓  parse, PCM → float; deinterleave + mixdown  §2
   ↓  selection slice (start/end sample)          §2.4
   ↓  Welch average, incoherent across channels   §3
   ↓  minimum-statistics noise floor              §4
   ↓  tone-match curve: ratio, smooth, gate, clamp §5
   ↓  optional graphic EQ, hand-dialed on top      §6
   ↓  minimum-phase FIR via real cepstrum         §7
   ↓  fade, export / convolve / plot              §8-§10
```

Two independent chains hang off the same store: an **offline** chain (files → spectra →
IR → WAV export) and a **realtime** chain (Web Audio `ConvolverNode` + `AnalyserNode` for
the live curve). The offline chain is the source of truth; the realtime chain is calibrated
to agree with it (§10.4).

---

## 2. Input conditioning

### 2.1 PCM decode — [wavParser.ts](../src/services/audio/wavParser.ts)

RIFF chunks are walked rather than assumed at fixed offsets (`findChunk`), so files with
`LIST`/`fact` chunks before `data` still parse. PCM integer formats only (format tag 1),
16 / 24 / 32-bit.

Integer → float uses a full-scale divisor of `2^(bits-1)`:

$$x[n] = \mathrm{clamp}\!\left(\frac{s[n]}{2^{b-1}},\,-1,\,1\right)$$

24-bit is assembled little-endian with a **signed** top byte (`getInt8`) so sign extension
is free: `(byte3 << 16) | (byte2 << 8) | byte1`.

### 2.2 Two representations, and why

The parser and decoder return **both** a mono mixdown and the deinterleaved channels:

$$x_{\text{mono}}[n] = \frac{1}{C}\sum_{c=0}^{C-1} x_c[n]
\qquad\text{and}\qquad
\{x_0, x_1, \dots\}$$

- **`audioData`** — the mono mix. Waveform, transport, convolver. The derived IR is mono and
  so is monitoring, so this is all those paths need.
- **`channels`** — the originals, never mixed. **Analysis reads these** (§3.2).

The split exists because $\frac{1}{C}\sum x_c$ is a **coherent** sum: it adds waveforms, so
inter-channel phase cancels *before* the FFT. On a phase-inverted pair it cancels the take to
digital silence; on a Haas-widened or M/S-processed master it carves a comb,
$|1 + e^{-j\omega d}| = 2|\cos(\omega d/2)|$, with nulls at odd multiples of $f_s/2d$.

Those notches are indistinguishable from real tone to everything downstream. The pipeline
correctly refuses to use inter-*take* phase (§7) — but it had no defence against intra-*take*
phase, which is a different problem arriving earlier. Two songs mastered at different stereo
widths would show a "tone difference" that was really a phase difference, and the matcher
would dutifully correct it with EQ.

Smoothing (§5.2) blurs the ripple but cannot recover the level that cancelled.

### 2.3 Compressed input — [audioDecoder.ts](../src/services/audio/audioDecoder.ts)

MP3 / M4A / AAC / OGG / FLAC go through `decodeAudioData`, which **always resamples to the
`AudioContext`'s rate**, and a default context takes the device's. The same file would
therefore decode at 44.1 kHz on one machine and 48 kHz on another, silently changing the rate
the analysis runs at. The container's native rate is not recoverable through Web Audio, so
the choice is between "device-dependent" and "always the same": the context is pinned to
48 kHz.

This matters less than it used to. Since the export path renders the filter at its target
rate (§11.1), the working rate no longer reaches the exported IR at all.

### 2.4 Selection gate

A Welch average over two frames of a single transient is not a tone. `assertLongEnough`
rejects anything shorter than

$$N_{\min} = \max(2 \cdot N_{\text{fft}},\; f_s \cdot \texttt{MIN\_ANALYSIS\_SECONDS})$$

with `MIN_ANALYSIS_SECONDS = 1`. Measured: a 200-sample selection produced ±17 dB of pure
garbage before this existed.

---

## 3. Spectral estimation — [fftProcessor.ts](../src/services/audio/fftProcessor.ts)

### 3.1 Windowing

Periodic (DFT-even) Hann, divisor `L` not `L-1`:

$$w[n] = \tfrac{1}{2}\left(1 - \cos\frac{2\pi n}{L}\right),\qquad n = 0 \dots L-1$$

The symmetric form is for filter design; for spectral analysis it biases the window by one
sample and breaks constant-overlap-add. Hamming (`0.54 - 0.46cos`) and rectangular are
selectable but Hann is the default.

### 3.1 Welch average

`computeFFT` looks only at the first `fftSize` samples — a few milliseconds of a multi-minute
take. Tone matching needs the *average* behaviour, so `computeAveragedFFT` averages **power**
over overlapping frames:

$$\hat{P}[k] = \frac{1}{F}\sum_{f=0}^{F-1} \left| X_f[k] \right|^2, \qquad
|X[k]| = \frac{\sqrt{\hat{P}[k]}}{N_{\text{fft}}/2}$$

with hop $H = N_{\text{fft}}(1-\text{overlap})$, and the per-frame power summed **across
channels**:

$$P_f[k] = \frac{1}{C}\sum_{c=0}^{C-1}\big|X_{f,c}[k]\big|^2$$

Three details that matter:

- **The channel sum is incoherent.** Magnitude is taken per channel, *then* added — so
  phase is already gone when the addition happens and cannot cancel. This is the other half
  of §2.2, and it is the whole reason analysis reads `channels` rather than `audioData`.
  Dividing by $C$ keeps a mono file and its dual-mono copy measuring identically.
- **Frames are strided, not truncated.** With `maxFrames = 512` and $F_{\text{total}}$
  available frames, the stride is $\lceil F_{\text{total}}/512 \rceil$ — the bounded frame
  budget is spread across the *whole* take rather than spent on its first few seconds.
- **Phase is discarded** — omitted from the result, not returned as zeros. An averaged
  magnitude has no meaningful phase, and a zero-filled array reads as a measurement of zero
  phase rather than as an absence. `FrequencySpectrum.phase` is therefore optional and
  present only on a single-frame `computeFFT`. The IR gets its phase from the minimum-phase
  construction in §7 instead.

### 3.2 Why 16384-point FFTs

At 44.1 kHz, a 2048-point FFT gives 21.5 Hz bins. A 1/6-octave band at 100 Hz is only 12 Hz
wide — **narrower than one bin** — so the entire low end arrives unsmoothed and noisy.

| `fftSize` | bin width @44.1 k | end-to-end error vs. known target curve |
|---|---|---|
| 2048 | 21.5 Hz | 0.66 dB |
| 16384 | 2.7 Hz | 0.06 dB |

Cost is milliseconds, offline. Overlap 0.75 (rather than 0.5) roughly doubles the frame
count for the same material, so the Welch average settles faster on short selections.

### 3.3 dB conversion — [spectrum.ts](../src/services/dsp/spectrum.ts)

$$L[k] = 20\log_{10}\frac{\max(|X[k]|,\,\epsilon)}{X_{\text{ref}}}, \qquad \epsilon = 10^{-10}$$

The clamp is the only thing standing between a digital-silence bin and `-Infinity`
propagating through every downstream average.

---

## 4. Noise floor by minimum statistics

The single most important trick in the whole pipeline, and the one that makes tone matching
usable on real recordings.

### 4.1 The problem a level threshold cannot solve

Outside the material's useful bandwidth, hiss **is** the measured spectrum — and in the bands
where the program has rolled off, hiss can be the *loudest* thing present. So "how far below
the peak is this bin?" answers nothing. Two takes always have different noise floors, so
their ratio up there is a difference of *noise*, not of tone. Apply it and you boost hiss by
tens of dB.

The right question is **"how far above this recording's own floor is this bin?"**

### 4.2 The estimator

A bin's per-frame periodogram power is roughly exponentially distributed about the true power
in that bin. Program material comes and goes, so its bins dip far below their own mean at
some point in the take; a constant hiss floor never does. That gap is the discriminator.

For $F$ independent $\mathrm{Exp}(\text{mean } m)$ samples, the minimum is
$\mathrm{Exp}(\text{mean } m/F)$, whose **median** is $(m/F)\ln 2$. So:

$$\hat{m}[k] = \operatorname{median}_{g}\Big( \min_{f \in g} P_f[k] \Big) \cdot \frac{F}{\ln 2}$$

Frames are split into `NOISE_GROUPS = 8` groups; the minimum is taken within each group and
the **median across groups** is used, so one freak-quiet frame cannot dominate.

Overlapping frames are correlated, so $F$ is not strictly the independent count — but measured
against stationary noise (whose true answer is 0 dB SNR) the uncorrected form lands within a
few tenths of a dB. Per-bin spread is about ±1.5 dB, which is the tolerance the gate
downstream is designed to absorb.

### 4.3 Why the noise frame is *shorter* than the analysis frame

`NOISE_FRAME_DIVISOR = 8`, floor `MIN_NOISE_FRAME = 512`.

The estimate must *see* the gaps in the performance. A 16384-point frame is 372 ms at
44.1 kHz — long enough to straddle a whole note, so every frame contains signal and the
minimum never reaches the floor. Short frames resolve the envelope, so the quiet moments
between notes actually appear as minima. Frequency resolution barely matters here: a noise
floor is broadband and smooth by nature.

### 4.4 Grid rescaling

The coarse noise grid must be comparable against the fine spectrum grid. Under the
$1/(N_{\text{fft}}/2)$ amplitude normalisation, amplitude scales as
$1/\sqrt{N_{\text{fft}}}$, so:

$$\text{gridScale} = \sqrt{\frac{K_{\text{coarse}}}{K_{\text{target}}}}$$

then linear interpolation stretches coarse → target (both grids span DC to Nyquist).

Returns `undefined` — meaning "no estimate, don't gate" — when there are fewer than 16 frames,
or fewer than half the groups have ≥2 frames.

### 4.5 The floor uses the same channel sum as the signal

The per-frame power fed to the minimum statistics is the same incoherent $\frac{1}{C}\sum_c
|X_c|^2$ the spectrum uses (§3.2). This is not cosmetic: measuring the floor on a mono
mixdown while the signal came from a power sum would put a channel-dependent offset between
the two, and the SNR gate in §5.4.3 is defined entirely by their difference. On anti-phase
channels the mixdown floor would read as silence against a full-level signal — infinite SNR,
and the gate would trust noise completely.

---

## 5. The tone-match curve — [irDerivation.ts](../src/services/dsp/irDerivation.ts)

### 5.1 Common frequency grid

Both spectra are converted to dB and the **reference is resampled onto the working file's
frequency grid** by linear interpolation in dB, held flat past both ends. Comparing bin index
to bin index skews the frequency axis whenever the two takes' sample rates differ — this is
what lets A be 48 kHz and B be 44.1 kHz.

### 5.2 Fractional-octave smoothing

$$\text{correction}[k] = \tilde{L}_{\text{ref}}[k] - \tilde{L}_{\text{work}}[k]$$

where $\tilde{L}$ is the smoothed level. Smoothing is a **box average over a log-frequency
band, run twice**:

$$\text{band}(f) = \left[\frac{f}{2^{\,\phi/2}},\; f \cdot 2^{\,\phi/2}\right],
\qquad \tilde{L}[k] = \frac{1}{|B_k|}\sum_{j \in B_k} L[j]$$

Three deliberate choices:

- **Two passes at $\phi/\sqrt{2}$.** Two boxcars convolve to a triangular kernel of roughly
  the requested width. A single boxcar leaves visible ripple.
- **Prefix sums.** `boxSmooth` builds a cumulative sum once, so each output bin is a
  subtraction — O(n) regardless of bandwidth.
- **Absolute bandwidth floor `minSmoothingHz = 20`.** A 1/6-octave band at 60 Hz is only 7 Hz
  wide — *narrower than the analysis resolution*. Without the floor, the low end arrives
  effectively unsmoothed and its noise becomes real filter ripple.

### 5.3 Level removal — log-weighted mean

The IR must be a tone curve, not a volume change. The mean correction over
`levelBandHz = [100, 8000]` is subtracted — but weighted $1/f$:

$$\Delta_0 = \frac{\sum_k c[k]\,/f_k}{\sum_k 1/f_k}$$

Bins are linear in frequency, so an *unweighted* mean over 100 Hz–8 kHz is really a mean of
the top octave alone (half the bins live there) and drags a spurious offset into the entire
curve. $1/f$ weighting gives every octave equal say.

### 5.4 Trust weighting

The final per-bin weight is a product of four independent gates, all in $[0,1]$:

$$w[k] = \underbrace{W_{\text{band}}(f_k)}_{\text{§5.4.1}} \cdot
\underbrace{\min(C^{\text{work}}_k, C^{\text{ref}}_k)}_{\text{§5.4.2}} \cdot
\underbrace{\min(S^{\text{work}}_k, S^{\text{ref}}_k)}_{\text{§5.4.3}}$$

$$\text{curve}[k] = \mathrm{clamp}\big((c[k] - \Delta_0)\cdot w[k],\; -\text{maxCut},\; +\text{maxBoost}\big)$$

`min` of the two takes, not the mean: if *either* recording is untrustworthy at a frequency,
the ratio there is untrustworthy.

#### 5.4.1 Band weight — raised cosine in log frequency

1 inside `[matchLowHz, matchHighHz]`, falling to 0 over `taperOctaves` outside it:

$$t = \frac{\log_2(f/f_{\text{stop}})}{\log_2(f_{\text{pass}}/f_{\text{stop}})},
\qquad W = \tfrac{1}{2} - \tfrac{1}{2}\cos(\pi\,\mathrm{clamp}(t,0,1))$$

The upper stop is clamped to Nyquist. `matchHighHz = 20000` is deliberately wide — a
**backstop, not a policy**. The SNR gate is the real defence and it is per-bin and
evidence-based; this band only bounds it. Measured with a 16 kHz edge on material that
genuinely had content up there: 2 dB lost at 18 kHz, 5.5 dB at 20 kHz.

#### 5.4.2 Level confidence — smoothstep below own peak

$$t = \mathrm{clamp}\!\left(\frac{\tilde{L}[k] - \tilde{L}_{\max} - \text{floorRelDb}}{\text{fullRelDb} - \text{floorRelDb}}, 0, 1\right),
\qquad C = t^2(3-2t)$$

Zero at 80 dB below the spectrum's own peak, one at 65 dB below. Smoothstep rather than a
linear ramp so the weight's *derivative* is continuous — a kink in the weight becomes a kink
in the filter.

#### 5.4.3 SNR confidence — the real gate, shipped off

Per-bin SNR against the take's own §4 floor, smoothed with the same fractional-octave kernel,
then the same smoothstep between `snrFloorDb` and `snrFullDb`.

**Off by default.** `DEFAULT_TONE_MATCH_CONFIG` ships `snrFloorDb = -200`, `snrFullDb = -199`
— a 1 dB span so far below any real SNR that the smoothstep is pinned at 1 everywhere, i.e.
the gate is a no-op. Enabling it means setting both explicitly (surfaced as the "SNR Gate"
control in `AdvancedSettings.vue`); `3` / `12` is the recommended pair and is what the
noise-rejection tests in §13 configure by hand. With those values:

**The stand-down guard.** If even the loud bins do not clear `minUsableSnrDb = 6` — measured
as the upper quartile of the smoothed SNR — the material is stationary enough that minimum
statistics cannot separate signal from noise (pure noise is the degenerate case: it measures
~1 dB). The estimate is then *meaningless rather than merely imprecise*, so the gate switches
itself off, logs a warning, and leaves the band weight as the only defence. Real playing
measures 15–20 dB here.

### 5.5 Clamping

`maxBoostDb = 12`, `maxCutDb = 24`. Asymmetric on purpose: **cuts are safe, boosts amplify
whatever is there**, including noise the gates did not catch.

---

## 6. Graphic EQ overlay — [graphicEqResponse.ts](../src/services/dsp/graphicEqResponse.ts), [useFreqPlotCurves.ts](../src/composables/useFreqPlotCurves.ts)

A hand-editable 9-band graphic EQ, layered **on top of** the derived tone-match curve — not
part of it. `deriveToneCurve` (§5) never sees it; it reads only the two spectra. The EQ exists
for the last mile a magnitude match can't reach on its own: a deliberate creative tweak, or a
nudge to a band the trust weighting (§5.4) correctly but inconveniently zeroed out.

### 6.1 Data model — [types/graphicEq.ts](../src/types/graphicEq.ts)

Nine fixed, octave-spaced bands — the familiar 10-band hardware ladder minus the 31 Hz sub:
62 / 125 / 250 / 500 / 1000 / 2000 / 4000 / 8000 / 16000 Hz. Each band is
`{id, frequency, gain, q, type, enabled}`, `type` one of `peaking | lowshelf | highshelf |
lowpass | highpass | notch` — deliberately 1:1 with native `BiquadFilterType`. Default
`q = √2` (RBJ one-octave peaking bandwidth), gain clamped to `[-15, +15]` dB, `q` to
`[0.1, 15]`. A master `enabled` switch sits alongside the band array; each band also carries
its own `enabled` so a band can be bypassed without losing its dialed-in settings.

### 6.2 Response — coefficients real, node imaginary

`biquadCoefficients` computes RBJ Audio EQ Cookbook coefficients — the same formulas the Web
Audio spec uses for `BiquadFilterNode` — but no `BiquadFilterNode` is ever created. The
correction is baked directly into the tone-match IR (§6.3) instead, so these coefficients
exist only to answer "what would a real biquad chain do here":

$$|H(e^{j\omega})|^2 = \frac{b_0^2+b_1^2+b_2^2 + 2(b_0b_1+b_1b_2)\cos\omega + 2b_0b_2\cos2\omega}
{1+a_1^2+a_2^2 + 2(a_1+a_1a_2)\cos\omega + 2a_2\cos2\omega}$$

`biquadResponseDb` evaluates this **analytically**, via the trig-identity expansion above
rather than an FFT — unlike §8's `irMagnitudeResponse`, which only works on a rendered
time-domain filter, this can be sampled at the tone curve's own arbitrary, non-uniform
frequency grid with no resampling. Enabled bands' dB responses are summed
(`graphicEqResponseDb`) — correct because summing dB is exactly what cascading biquads in
series does.

### 6.3 Where it joins the pipeline

`applyGraphicEq(curve, eq, sampleRate)` adds the EQ's dB response onto `ToneCurve.curveDb` and
returns a new `ToneCurve`; with the master off it returns the *same object* — a referential
no-op — and a disabled or all-zero-gain band set provably contributes 0 dB.

The store's `curveToRender(sampleRate)` is the one seam every render site goes through: it
calls `applyGraphicEq` before every `renderToneMatchIR` (§7) — the live convolver, a tap-count
change, **and export** (§11). The EQ is baked into the exported WAV/JSON, not just the
on-screen curve; there is no way to export the tone-match-only IR while the EQ is on.

Editing a band writes state synchronously, then debounces the expensive minimum-phase re-bake
by **120 ms** — short enough to feel live while dragging, since only the FFT-based cepstrum
step needs debouncing. Toggling the master switch re-renders immediately, no debounce.
Separately, the plot itself gets a **cheap live preview** while dragging: the on-screen trace
recomputes `curveDb + eqDb` directly on the curve's own frequency grid (skipping the cepstrum
render entirely) so the displayed shape tracks the drag at full rate even though the actual
FIR only updates every 120 ms.

### 6.4 Handle interaction — [freqplot](https://github.com/mpragliola/freqplot) (`eq` curve type)

The band is rendered and interacted with entirely by the `freqplot` library's own canvas —
no DOM handles, no custom pixel-space math against the host chart's internals. The bands
themselves live in `store.references[id].graphicEq.bands`, mapped each render to freqplot's
`EqBand[]` (`useFreqPlotCurves.ts`'s `toEqBand`/`toGraphicEqBandType`, the only translation
needed: this app's `peaking` is freqplot's `peak`, every other `type` value matches).
`Freqplot`'s `band-change` event reports edits back by array index (bands never reorder, so
index-matching against the store's array is safe), which `onBandChange` turns into a
`store.updateGraphicEqBand` call.

- **Drag the handle** sets frequency/gain, clamped to `[minFreq, maxFreq]` and
  `[minGain, maxGain]`.
- **Drag the zone** around a handle (not the handle itself) adjusts **Q only**.
- **Click a handle** selects it, revealing freqplot's own in-canvas type-switch and
  bypass buttons — no separate popover.
- **Double-click** resets a band to its untouched default.

No inter-band interpolation or snapping: each band is an independent biquad, and the combined
shape is the dB sum, not a curve fitted through the handle positions (§14).

---

## 7. Minimum-phase FIR construction

An IR loader expects minimum phase. Using the program material's own phase yields a smeared,
unusable filter. The curve is rendered via the **real-cepstrum method**:

1. Build $\ln|H(\omega)|$ over the full symmetric spectrum, sampling the dB curve at each FFT
   bin frequency:
   $$\ln|H_k| = \frac{\text{curveDb}(f_k)}{20}\ln 10$$

2. Real cepstrum by inverse FFT:
   $$\hat{c}[n] = \mathcal{F}^{-1}\{\ln|H|\}$$

3. **Fold** the anti-causal half onto the causal half (this is the Hilbert-transform relation
   that makes the result minimum-phase):
   $$\hat{c}_{\min}[n] = \begin{cases}
   \hat{c}[0] & n = 0\\
   2\hat{c}[n] & 1 \le n < N/2\\
   \hat{c}[N/2] & n = N/2\\
   0 & \text{otherwise}
   \end{cases}$$

4. Forward FFT, then exponentiate — the result is the minimum-phase transfer function, with
   phase now *derived from* the magnitude:
   $$H_{\min}[k] = \exp(\Re Z_k)\big(\cos \Im Z_k + j\sin \Im Z_k\big), \qquad Z = \mathcal{F}\{\hat{c}_{\min}\}$$

5. Inverse FFT, take the first `taps` real samples.

**Cepstrum length.** `fftLen = max(nextPow2(taps · 8), 32768)` — generously oversampled. A
too-short cepstrum wraps the filter's own tail back onto its head and quietly distorts the
low end.

**Tail fade.** A short half-Hann over `min(128, taps/4)` samples so truncation does not leave
a step:

$$h[N-M+i] \mathrel{*}= \tfrac{1}{2}\left(1 + \cos\frac{\pi i}{M}\right)$$

Kept deliberately short: in a minimum-phase filter **the tail is what resolves the low end**,
so fading a large fraction of it costs bass accuracy.

**No peak rescaling.** The first sample of a minimum-phase filter routinely exceeds 1. It is
not a clipping predictor, and rescaling the IR to force it under throws away the level match —
measured at up to 7 dB of unwanted attenuation when it did. Output headroom is a *playback*
concern and is handled there (§9.2) using the reported `l1Norm`.

### 7.1 Curve and filter are separate objects

`deriveToneCurve` returns a `ToneCurve` — frequencies, dB gains, and the level offset it
removed. `renderToneMatchIR` turns that into an `ImpulseResponse` at a **given rate and tap
count**. The curve has no rate of its own, so:

- Exporting at 48 kHz from a 44.1 kHz analysis renders a *native* 48 kHz filter. Nothing is
  resampled, ever (§11).
- Changing the tap count is one cepstrum FFT, not a re-analysis.
- Extrapolation past the curve's own Nyquist is safe by construction: `bandWeight` has
  already driven the curve to 0 dB there and `interpolateAt` holds flat, so the extra
  octave renders as unity gain.

### 7.2 The L1 norm

Rendering also reports

$$\|h\|_1 = \sum_n |h[n]|$$

which is the filter's gain for the worst input it could ever be handed — the signal
$\mathrm{sign}(h[-n])$, which makes every tap add constructively at one instant. This is the
headroom bound (§9.2). Measured on the test fixtures: $\|h\|_1 = 11.1$ dB against a largest
boost of 5.3 dB.

---

## 8. IR magnitude response (verification plot) — [irResponse.ts](../src/services/dsp/irResponse.ts)

$$H[k] = \mathrm{FFT}\{h\}, \qquad L[k] = 20\log_{10}\max(|H[k]|, 10^{-9})$$

FFT size is `max(8192, nextPow2(2·taps))` — the IR must fit with room to spare or truncation
shows up as ripple in the response. DC is dropped: meaningless for a tone curve, and $f=0$
cannot be plotted on the log axis the spectra use. This is a genuine round-trip check —
the plotted curve is what the *filter actually does*, not the curve we asked for.

---

## 9. Playback

### 9.1 Offline convolution — [convolution.ts](../src/services/audio/convolution.ts)

Overlap-add FFT convolution above 64 taps, direct time-domain below.

$$y = \mathrm{IFFT}\big(\mathrm{FFT}(x_{\text{block}}) \cdot \mathrm{FFT}(h)\big)$$

with `fftSize = nextPow2(4·taps)`, `blockSize = fftSize - taps + 1`, and the IR spectrum
computed **once** and reused for every block. Direct convolution is O(samples × taps): a
3-minute take through a 2048-tap IR is ~16 billion multiply-adds — minutes of blocked main
thread. This is O(n log n).

Complex multiply per bin, written out because the arrays are interleaved:
`(ar·br − ai·bi, ar·bi + ai·br)`.

Normalization is **off by default** here and `normalize = false` on the live `ConvolverNode`,
for the same reason as §7: a tone-match IR carries a deliberate gain.

### 9.2 Headroom and the volume law — [headroom.ts](../src/services/audio/headroom.ts)

$$\text{gain} = v^2 \cdot \text{trim}$$

**Trim is measured, not bounded.** Both closed-form bounds are too pessimistic to listen
through: $\|h\|_1$ is the gain for $\mathrm{sign}(h[-n])$, a sign-matched impulse train no
real recording contains — 10.6 dB on a ±6 dB curve, measured — and $\max|H(f)|$ is the
steady-sine bound, which errs the other way on transients. `measureHeadroomTrim` instead
convolves the take's own **loudest 10-second window** (`PEAK_SCAN_SECONDS`, picked by a
sliding-energy scan over 100 ms blocks so a count-in or silent intro at the head of the file
isn't mistaken for the peak) through the rendered IR and reads the true output peak:

$$\text{trim} = \begin{cases}
10^{-\text{PEAK\_MARGIN\_DB}/20} / \text{peak} & \text{peak exceeds the margin} \\
1 & \text{otherwise}
\end{cases}, \qquad \text{PEAK\_MARGIN\_DB} = 1$$

On real material this usually asks for no trim at all. Only when there is no audio loaded to
measure against does it fall back to the closed-form $\|h\|_1$ bound from §7.2
(`boundedTrim`) — worst-case-safe but, per the above, far louder a cut than the take would
actually need.

The trim is applied to **both** the dry and wet paths, so A/B switching compares tone and not
loudness. It is cached per `(ir, source)` pair and recomputed whenever the IR changes
(`refreshLiveConvolver`).

The fader is **squared**: a linear fader spends almost all its travel in the loud region —
half way reads as barely quieter and the control feels broken until it is nearly at zero.
Gain changes use `setTargetAtTime` (τ = 10 ms); stepping the gain on a sounding buffer clicks.

---

## 10. Live spectrum — [useLiveSpectrum.ts](../src/composables/useLiveSpectrum.ts)

Multi-channel sources are summed the same way as the offline path: `readCombined` sums each
`AnalyserNode`'s power **after** taking magnitude, never before — the same incoherent
discipline as §2.2/§3.2/§4.5, and for the same reason (a phase-inverted or Haas-widened live
source must not comb-cancel before it reaches the plot).

### 10.1 Log bucketing

`CURVE_POINTS = 192` geometrically spaced buckets over the analyser's linear bins:

$$f_{\text{low}}(p) = f_{\min}\left(\frac{f_{\text{nyq}}}{f_{\min}}\right)^{p/P},
\qquad f_{\text{centre}} = \sqrt{f_{\text{low}} f_{\text{high}}}$$

The analyser hands back linear bins that, on a log axis, crowd everything above 1 kHz into
pixel mush at the cost of a full redraw per frame. 192 log-spaced points look identical and
keep the per-frame restyle cheap. The centre is the **geometric** mean so the point sits where
the bucket looks centred on a log axis.

### 10.2 Two sampling modes, by bucket width

- **Wide bucket (> 1 bin): peak.** Above a few hundred Hz a bucket covers many bins and the
  peak is what matters — averaging buries narrow content that is plainly audible.
- **Narrow bucket (≤ 1 bin): interpolate at the centre.** Down low, several buckets fall
  inside one 10.8 Hz bin; taking that bin's value for each draws the low end as a staircase.
  Interpolation between neighbours at the exact centre turns the same data into a smooth slope.

Interpolation is done **in dB, not linear magnitude** — the axis is logarithmic, so a straight
line between two decibel values is the straight line the eye expects.

### 10.3 Running average — power domain, time-based weight

The static spectra on the same plot are Welch averages of a whole selection, so only a
*time-averaged* live curve is comparable to them by eye.

$$\alpha = 1 - e^{-\Delta t / \tau}, \qquad \tau = 1.5\ \text{s}$$
$$\bar{P}[p] \mathrel{+}= (P[p] - \bar{P}[p])\,\alpha, \qquad P = 10^{L/10}$$

Three points:

- **Linear power, not dB.** Averaging dB values is a geometric mean, which reads several dB
  below the Welch average of the same material — the two curves would never line up. Note the
  power form $10^{L/10}$ and its inverse $10\log_{10}$.
- **Weight from elapsed time**, not a fixed per-frame constant, so a dropped frame does not
  quietly lengthen the time constant. The first frame uses $\alpha = 1$ (it seeds the average).
- **Silence gate at −70 dB.** Below it the frame is not folded in at all. Between phrases the
  true energy average sinks toward the floor — honest, but it reads as the curve dying.
  Freezing holds the last balance until the music returns.

τ = 1.5 s is the classic RTA "slow" setting: long enough to stop chasing individual notes and
read as tonal balance, short enough to still follow a change of section.

Frame rate is throttled to `FRAME_INTERVAL_MS = 40` (~25 fps); rAF rate buys nothing visible
on a smoothed spectrum and triples the redraws.

### 10.4 The 7.5 dB calibration offset

The analyser and the offline path measure the same signal but normalise differently:

| | divisor | window | coherent gain |
|---|---|---|---|
| `computeAveragedFFT` | `fftSize/2` | Hann | 0.50 |
| Web Audio `AnalyserNode` | `fftSize` | Blackman | 0.42 |

$$\text{ratio} = \frac{0.5}{0.42/2} = 2.38, \qquad 20\log_{10}(2.38) \approx 7.5\ \text{dB}$$

Without it the moving curve sits ~7 dB below the static ones it is meant to overlay.
`smoothingTimeConstant = 0.7` on the analyser itself: raw frames flicker several dB per bin
on music, and 0.7 settles that without visibly trailing transients. Analyser `fftSize` is
user-selectable (default 4096) — it changes only the live display, never the derived IR.

---

## 11. Export — [fileUtils.ts](../src/utils/fileUtils.ts), [ImpulseResponseDisplay.vue](../src/components/ImpulseResponseDisplay.vue)

### 11.1 Rate: render, never resample

The export rate is achieved by **rendering a new filter at that rate** from the cached tone
curve, graphic EQ folded in (§6, §7.1). The IR is never resampled.

This replaced a linear-interpolation resampler. Linear interpolation is convolution with a
triangular kernel, so its response is $\mathrm{sinc}^2(f T)$:

| f | droop, 44.1 kHz source |
|---|---|
| 5 kHz | −0.37 dB |
| 10 kHz | −1.5 dB |
| 20 kHz | **−6.3 dB** |

An impulse response has real content right up to Nyquist, so this was not a rounding error —
a 48 kHz export lost six dB of top octave from a pipeline that fights for 2 dB elsewhere
(§5.4.1). Re-trimming the stretched result back to a power of two made it worse: it cut the
tail *and* the §7 fade, leaving a step discontinuity. Rendering at the target rate is both
exact and cheaper than the polyphase resampler that would otherwise have been needed.

### 11.2 Tap count

User-selectable: 512 / 1024 / 2048 / 4096. Hardware loaders commonly cap at 512 or 1024 and
truncate anything longer **with no fade**, which shows up as ripple — matching the target
avoids that. In the other direction, a minimum-phase filter resolves the low end in its tail,
so 4096 is what buys accuracy below 60 Hz on full-range material. Changing it re-renders from
the curve, so the live convolver and the next export move together.

### 11.3 Format and dither

- **24-bit PCM** (default), **16-bit PCM**, or **32-bit IEEE float** (`encodeWavFloat32`,
  format tag 3). Integer depths are signed little-endian.
- Full-scale integer conversion uses $2^{b-1} - 1$ on export (versus $2^{b-1}$ on import) so a
  +1.0 sample cannot wrap. The clamp is applied *after* dither, in integer units.
- **TPDF dither**, ±1 LSB as the difference of two uniform draws, on by default at 16-bit and
  off at 24-bit.

  An IR needs dither more than program material does. A minimum-phase filter keeps its
  low-frequency information in a long, quietly decaying tail. Round that without dither and
  every sample below half an LSB becomes *exactly zero* — not noisy, gone — so the filter
  loses the part that resolves the bass and gains a hard truncation where the tail was.
  Measured on a decaying test tail: undithered zeroes all 1185 sub-LSB samples; dithered
  keeps the tail alive with zero-mean error. Triangular rather than rectangular so the error
  is also independent of the signal, instead of a correlated artefact tracking the decay.
- **8-bit was removed.** Its LSB sits at −42 dBFS and a tone-match IR peaks around 0.05–0.3,
  giving 22–26 dB of usable resolution: the quantization error would be a larger filter than
  the correction itself.
- JSON coefficient copy is also available for loaders that take raw taps.

---

## 12. Tuning constants, with the reasoning

| Constant | Value | Why |
|---|---|---|
| `fftSize` | 16384 | 1/6-octave at 100 Hz is narrower than a 2048-FFT bin; error 0.66 → 0.06 dB |
| `overlap` | 0.75 | ~2× the frames per take; Welch average settles on short selections |
| `taps` | 2048 (512–4096) | Power of two; enough tail to resolve the low end. User-selectable (§11.2) |
| `smoothingOctave` | 1/6 | Resolves real tonal features, rejects per-bin noise |
| `minSmoothingHz` | 20 | A 1/6-octave band is ≈0.116·f wide, so below ~170 Hz it falls under the floor |
| `maxBoostDb` / `maxCutDb` | 12 / 24 | Cuts are safe; boosts amplify noise |
| `matchLowHz` / `matchHighHz` | 30 / 20000 | Wide backstop; the SNR gate is the real defence |
| `taperOctaves` | 0.6 | Gentle enough not to ring, tight enough to exclude junk |
| `floorRelDb` / `fullRelDb` | −80 / −65 | Level confidence ramp, relative to each take's own peak |
| `snrFloorDb` / `snrFullDb` | **−200 / −199 (off by default)** | Shipped off — see §5.4.3. Set to 3 / 12 to enable noise rejection; that pair absorbs the ±1.5 dB spread of the noise-floor estimate |
| `minUsableSnrDb` | 6 | Stationary noise measures ~1 dB, real playing 15–20 dB (only matters once the gate above is enabled) |
| `levelBandHz` | 100–8000 | Broad enough to be a level, narrow enough to dodge the extremes |
| `GRAPHIC_EQ_FREQUENCIES` | 62/125/250/.../16000 Hz | Classic 9-band octave ladder (§6) |
| `DEFAULT_BAND_Q` | √2 | RBJ 1-octave peaking bandwidth, sensible default for octave-spaced bands |
| `GRAPHIC_EQ_GAIN_RANGE_DB` / `GRAPHIC_EQ_Q_RANGE` | ±15 / 0.1–15 | Handle-drag and popover clamp range (§6) |
| graphic-EQ debounce | 120 ms | Feels live while dragging; state write is synchronous, only the cepstrum re-bake is debounced (§6) |
| `PEAK_SCAN_SECONDS` / `PEAK_MARGIN_DB` | 10 s / 1 dB | Loudest-window headroom measurement (§9.2) |
| `LIVE_ANALYSER_SMOOTHING` | 0.7 | Settles per-bin flicker without trailing transients |
| `LIVE_ANALYSER_DB_OFFSET` | 7.5 dB | Normalisation + window-gain difference (§10.4) |
| `AVERAGE_TAU_SEC` | 1.5 | RTA "slow" |
| `MIN_ANALYSIS_SECONDS` | 1 | Below this the "IR" is noise (measured ±17 dB) |

---

## 13. Validation

[tests/unit/services/toneMatchAccuracy.test.ts](../tests/unit/services/toneMatchAccuracy.test.ts) drives
the whole chain with synthetic fixtures whose true answer is known analytically —
[tests/fixtures/curves.mjs](../tests/fixtures/curves.mjs) is shared by the fixture generator
*and* the assertions, so the expected curve can never drift from the baked-in one.

| Property under test | Tolerance |
|---|---|
| Reproduces a known EQ curve, 50 Hz – `matchHighHz` | < 0.5 dB max error |
| Survives a sample-rate mismatch between takes, 125 Hz – 5 kHz | < 1 dB |
| A noise-floor difference does **not** become a tone difference | < 1 dB (< 1.5 dB below 100 Hz) |
| …including at 16 kHz and 20 kHz, where the floors differ most | < 0.5 dB |
| Reports ~0 dB SNR on stationary noise, so the gate stands down | median < 1.5 dB |
| Keeps the matched level — IR is not rescaled to tame its peak sample | < 1 dB |

The SNR-gate cases above override `snrFloorDb`/`snrFullDb` to `3`/`12` explicitly, since the
shipped default (§5.4.3, §12) leaves the gate off.

[tests/unit/services/graphicEqResponse.test.ts](../tests/unit/services/graphicEqResponse.test.ts)
covers the graphic EQ (§6):

| Property under test | Tolerance |
|---|---|
| Every band disabled, or a disabled band mixed with an enabled one | exact 0 dB / no leak |
| A peaking band reports its own dialed gain at its own centre frequency | < 0.01 dB |
| Two peaking bands at the same frequency sum their gain (cascade, not average) | < 0.1 dB |
| Butterworth-Q ($1/\sqrt2$) lowpass/highpass sits at −3.01 dB at its own cutoff | < 0.1 dB |
| A notch drops more than 40 dB at its own centre | — |
| `applyGraphicEq` is a referential no-op when the master toggle is off | exact (`===`) |
| Enabled EQ adds onto `curveDb` in dB and leaves `frequencies` untouched | < 0.1 dB |

[tests/unit/services/irRendering.test.ts](../tests/unit/services/irRendering.test.ts) covers the
curve → filter step:

| Property under test | Tolerance |
|---|---|
| Same magnitude response rendered at 44.1 and 48 kHz, 1–20 kHz | < 0.2 dB |
| Unity gain above the curve's own Nyquist when rendered higher | < 1 dB |
| Tap count does not move the midband, 500 Hz – 8 kHz | < 1 dB |
| $\|h\|_1$ bounds the worst-case (`sign`-matched) output peak | exact |
| …and the trimmed chain cannot exceed full scale | exact |
| $\|h\|_1$ exceeds `maxGainDb`, i.e. the boost is not a safe trim | — |

[tests/unit/services/stereoAnalysis.test.ts](../tests/unit/services/stereoAnalysis.test.ts)
covers the channel path:

| Property under test | Tolerance |
|---|---|
| Anti-phase channels measure like the source (mono mix is silence) | < 0.01 dB |
| A Haas-widened take is not comb-filtered — mono notches > 10 dB, incoherent does not | < 1.5 dB tilt |
| Dual mono measures identically to mono | < 0.01 dB |
| Uncorrelated channels average in power, not amplitude | < 0.5 dB |
| The noise floor uses the same channel sum as the signal | ~0 dB SNR |
| `wavParser` deinterleaves, and the mix is the channel average | < 1e-6 |

[tests/unit/utils/fileUtils.test.ts](../tests/unit/utils/fileUtils.test.ts) covers export:

| Property under test | Tolerance |
|---|---|
| Dither preserves a sub-LSB tail that undithered rounding zeroes | > 10% non-zero |
| Dithered error is zero-mean | < 1 LSB |
| Full-scale sample does not wrap when dither is applied | exact |
| Float32 round-trips exactly, and does not clamp an IR peak > 1 | exact |

---

## 14. Known limitations

- **No audio resampling anywhere.** The analysis path resamples *spectra* in dB (§5.1) and the
  export path re-renders the filter at the target rate (§11.1). Nothing resamples a waveform,
  which is deliberate — the linear-interpolation resampler that used to serve the export path
  cost 6.3 dB at 20 kHz. Compressed input is the one exception, and the browser's decoder
  handles it (§2.3).
- **No time alignment.** The two takes are assumed to be the same performance or the same
  stationary material. There is no delay estimation, and none is needed for a magnitude match —
  but a large latency difference makes the *level* comparison of short selections noisier.
- **Minimum phase only.** Phase differences between the takes are discarded by design; a
  linear-phase or excess-phase match is not derivable from averaged magnitudes.
- **Mono IR, mono monitoring.** Analysis is per-channel and phase-safe (§2.2, §3.2), but the
  derived filter is mono — which is what hardware IR loaders take — and playback auditions
  the mono mix. A wide master therefore still *sounds* narrow while A/B-ing, even though the
  curve derived from it is correct. Stereo monitoring is the open item; it would buy no
  accuracy, only a fairer listen.
- **The noise-floor estimator needs gaps.** Fully stationary material (sustained drones, noise)
  trips the §5.4.3 stand-down and falls back to the band weight alone. Moot unless the SNR
  gate has been turned on — it ships off (§5.4.3, §12).
- **Graphic EQ bands don't interpolate.** Each of the 9 bands (§6) is an independent biquad;
  the on-screen shape is the dB sum of whichever are enabled, not a curve fitted through the
  handles. Getting a smooth shape between two adjacent bands means dialing in a band between
  them, not dragging halfway and expecting the neighbours to follow.
