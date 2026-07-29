<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Help</h2>
        <button class="close-btn" title="Close" aria-label="Close" @click="$emit('close')">
          <Icon name="x" size="24" />
        </button>
      </div>

      <div class="modal-body">
        <div class="about-header">
          <img src="/logo.svg" alt="Tomas" class="about-logo" />
          <p class="about-tagline">Tone Matcher Software</p>
          <p class="about-sub">by Marco Pragliola</p>
        </div>

        <div class="divider"></div>

        <div
          v-for="(chapter, i) in chapters"
          :key="chapter.title"
        >
          <div class="chapter">
            <button class="chapter-header" @click="toggle(i)">
              <span class="chapter-title">{{ chapter.title }}</span>
              <Icon
                name="chevron-down"
                size="14"
                class="chevron"
                :class="{ open: openSet.has(i) }"
              />
            </button>
            <div
              class="chapter-body-wrap"
              :class="{ open: openSet.has(i) }"
            >
              <div class="chapter-body" v-html="chapter.html" />
            </div>
          </div>
          <div v-if="i < chapters.length - 1" class="divider" />
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-primary" @click="$emit('close')">Got it</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import Icon from './Icon.vue';

defineEmits<{ close: [] }>();

const chapters = [
  {
    title: 'What is tone matching?',
    html: `<p class="text">
      Every recording chain — microphone, preamp, room, cabinet — colours the sound in its own way.
      Tone matching is the process of measuring <em>how</em> two recordings differ in frequency balance
      and then automatically generating a correction filter so that one sounds like the other.
      Instead of spending hours tweaking EQ by ear, Tomas does the math: it analyses the spectral
      envelope of both tracks and computes exactly how much to boost or cut at every frequency.
    </p>`,
  },
  {
    title: 'What is an impulse response (IR)?',
    html: `<p class="text">
      An impulse response is a short audio file that fully describes how a linear system — an EQ,
      a reverb room, a speaker cabinet, a microphone — responds to sound. Play a theoretically
      perfect click (an impulse) through the system and record what comes out: that recording
      <em>is</em> the IR. Because of how convolution works, feeding any audio signal through that
      same math produces exactly the same result as running it through the real system.
      Tomas generates an IR that encodes the tonal difference between your two tracks, so anything
      you convolve with it will inherit that correction.
    </p>`,
  },
  {
    title: 'Workflow',
    html: `<ol class="steps">
      <li>Load or record a reference track into slot <strong>A</strong> and your target into slot <strong>B</strong>.</li>
      <li>The spectrum and IR are computed automatically — the bar-chart and tool icons in the header turn blue when ready.</li>
      <li>Use the <strong>Playback</strong> panel to audition the result or export the IR.</li>
    </ol>`,
  },
  {
    title: 'Using the IR — in a DAW',
    html: `<p class="text">
      Export the IR from the Playback panel, then load it into a convolution plugin on the track
      you want to correct — for example <strong>Logic Pro's Space Designer</strong>,
      <strong>Waves IR-1</strong>, or the free <strong>OpenAir</strong> / <strong>Convology XT</strong>.
      Drop the IR file into the plugin, set the mix to 100&nbsp;% wet, and the track will instantly
      adopt the tonal character of your reference. Works on any DAW that supports convolution inserts:
      Pro Tools, Ableton Live, Reaper, Cubase, etc.
    </p>`,
  },
  {
    title: 'Using the IR — in a guitar multi-fx',
    html: `<p class="text">
      Modern digital multi-fx units (Fractal Axe-Fx, Line 6 Helix, Neural DSP Quad Cortex,
      Boss GT series…) include an <strong>IR block</strong> or <strong>user cab slot</strong>
      that accepts WAV impulse responses. Copy the exported IR to the unit via USB or the
      companion app, assign it to an IR block in your signal chain, and the unit will apply
      the correction in real time. This is useful for matching the tone of a modelled amp to a
      real recording, or for swapping between cabinet voicings live without touching an EQ.
    </p>`,
  },
  {
    title: 'Managing expectations',
    html: `<p class="text">
      Tone matching is a powerful starting point, but it has limits worth understanding.
    </p>
    <p class="text" style="margin-top:10px">
      The correction filter operates purely in the <strong>frequency domain</strong>: it can
      shift energy balance across the spectrum, but it cannot change a sound's underlying
      <em>character</em> — its transient response, harmonic saturation, dynamic behaviour,
      room reflections, or the non-linearities of analogue gear. A bright solid-state preamp
      EQ'd to match a warm tube preamp will still sound like a solid-state preamp.
    </p>
    <p class="text" style="margin-top:10px">
      Results are also only as good as the material. Both recordings should contain similar
      musical content and dynamics — a sparse clean guitar passage compared against a
      heavily compressed rock mix will produce a correction that reflects the arrangement
      difference as much as the EQ difference. Selecting a representative region in each
      waveform, rather than the full file, helps considerably.
    </p>
    <p class="text" style="margin-top:10px">
      Think of the output IR as a <strong>first-pass EQ suggestion</strong>, not a silver
      bullet: use Tomas to get 80&nbsp;% of the way there, then fine-tune by ear.
    </p>`,
  },
  {
    title: 'Waveform editor',
    html: `<ul class="tips">
      <li>Drag on the waveform to select a region — the spectrum is computed from that region only.</li>
      <li>Scroll to zoom; drag the scroll bar at the bottom to pan.</li>
      <li>The <strong>normalize</strong> button (arrows icon) peak-normalises the slot so quiet recordings compare fairly.</li>
      <li>Toggle between waveform and spectrogram views with the chart icon.</li>
    </ul>`,
  },
  {
    title: 'Advanced settings',
    html: `<p class="text">
      Open the settings panel (gear icon) to fine-tune how the spectrum is analysed and
      how the correction filter is built.
    </p>
    <ul class="tips" style="margin-top:10px">
      <li><strong>FFT Size</strong> — analysis resolution. Higher gives narrower, more accurate
      frequency bins (especially in the low end), at the cost of a little extra compute time.</li>
      <li><strong>Window</strong> — the FFT windowing function. Hann is a good default for
      music material.</li>
      <li><strong>Filter Taps</strong> — length, and therefore precision, of the generated
      correction IR.</li>
      <li><strong>Max Boost / Max Cut</strong> — clamp how aggressively the filter can push
      the spectrum in either direction, keeping noisy or empty bands from producing extreme
      corrections.</li>
      <li><strong>Smoothing</strong> — averages the correction curve over a fraction of an
      octave. Finer settings track detail more closely; coarser settings give a gentler,
      more natural-sounding curve.</li>
      <li><strong>Match Band</strong> — the frequency range where both recordings actually
      have signal above the noise floor. Outside this band the correction tapers off
      automatically rather than amplifying noise.</li>
    </ul>`,
  },
];

const openSet = reactive(new Set<number>());

function toggle(i: number) {
  openSet.has(i) ? openSet.delete(i) : openSet.add(i);
}
</script>

<style lang="scss" scoped>
@use '../styles/variables' as *;
@use '../styles/mixins' as *;

$transition-accordion: 250ms ease;

.modal-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity $transition-base ease-out;

  .modal-content {
    transition: opacity $transition-base ease-out, transform $transition-base ease-out;
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .modal-content {
    opacity: 0;
    transform: scale(0.96);
  }
}

.modal-content {
  background-color: var(--color-modal-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  max-width: 520px;
  width: 90%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-5);
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-modal-header);
  border-radius: var(--radius-md) var(--radius-md) 0 0;

  h2 {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: 600;
  }
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: color $transition-fast;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover { color: var(--color-text-primary); }
}

.modal-body {
  padding: var(--space-5);
  overflow-y: auto;
  flex: 1;
}

.about-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0 16px;
  gap: 6px;
}

.about-logo {
  height: 56px;
  width: auto;
  @include themed(filter, none, invert(1), $earth: invert(1));
}

.about-tagline {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-text-primary);
}

.about-sub {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.modal-footer {
  padding: var(--space-5);
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
}

.chapter-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: none;
  border: none;
  padding: 2px 0;
  cursor: pointer;
  text-align: left;

  &:hover .chapter-title { color: var(--color-text-primary); }
}

.chapter-title {
  font-size: var(--font-size-label);
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  transition: color $transition-fast;
}

.chevron {
  color: var(--color-text-secondary);
  flex-shrink: 0;
  transition: transform $transition-accordion;

  &.open { transform: rotate(-180deg); }
}

.chapter-body-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows $transition-accordion;

  &.open {
    grid-template-rows: 1fr;

    .chapter-body {
      padding-top: 10px;
      padding-bottom: 2px;
    }
  }
}

.chapter-body {
  overflow: hidden;
  min-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  transition: padding $transition-accordion;
}

.divider {
  height: 1px;
  background-color: var(--color-border);
  margin: 14px 0;
}

:deep(.text) {
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  color: var(--color-text-primary);
}

:deep(.steps),
:deep(.tips) {
  margin: 0;
  padding-left: 20px;
  font-size: var(--font-size-sm);
  line-height: 1.7;
  color: var(--color-text-primary);
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all $transition-fast;

  &-primary {
    background-color: var(--color-accent);
    color: var(--color-accent-text);

    &:hover { filter: brightness(1.1); }
  }
}
</style>
