<template>
  <div class="advanced-settings">
    <button class="toggle-btn" @click="open = !open" :aria-expanded="open">
      <span class="toggle-label">Advanced Settings</span>
      <Icon :name="open ? 'chevron-down' : 'chevron-right'" size="16" class="toggle-chevron" />
    </button>

    <Transition name="collapse">
      <div v-if="open" class="settings-body">
        <div class="section">
          <label class="section-title">FFT</label>

          <div class="control-row">
            <div class="label-with-tooltip">
              <label class="input-label">Size</label>
              <TooltipIcon text="Analysis FFT length. Larger resolves the low end better — a 1/6-octave band at 100 Hz is narrower than one bin at 2048 — at the cost of a slower pass. 16384 is the default." />
            </div>
            <select :value="store.fftConfig.fftSize" class="input-select" @change="store.setFFTConfig({ fftSize: Number(($event.target as HTMLSelectElement).value) as any })">
              <option value="512">512</option>
              <option value="1024">1024</option>
              <option value="2048">2048</option>
              <option value="4096">4096</option>
              <option value="8192">8192</option>
              <option value="16384">16384</option>
            </select>
          </div>

          <div class="control-row">
            <div class="label-with-tooltip">
              <label class="input-label">Window</label>
              <TooltipIcon text="Window applied to each analysis frame. Hann is the sane default; rectangular leaks energy between bins and smears the spectrum." />
            </div>
            <select :value="store.fftConfig.window" class="input-select" @change="store.setFFTConfig({ window: ($event.target as HTMLSelectElement).value as any })">
              <option value="hann">Hann</option>
              <option value="hamming">Hamming</option>
              <option value="rectangular">Rectangular</option>
            </select>
          </div>
        </div>

        <div class="divider" />

        <div class="section">
          <label class="section-title">Tone Match</label>

          <div class="control-row">
            <div class="label-with-tooltip">
              <label class="input-label">Filter Taps</label>
              <TooltipIcon text="Length of the rendered minimum-phase FIR. More taps resolve the low end more precisely; hardware IR loaders usually expect 1024 or 2048." />
            </div>
            <select :value="store.toneMatchConfig.taps" class="input-select" @change="store.setToneMatchConfig({ taps: Number(($event.target as HTMLSelectElement).value) })">
              <option value="512">512</option>
              <option value="1024">1024</option>
              <option value="2048">2048</option>
              <option value="4096">4096</option>
            </select>
          </div>

          <div class="control-row">
            <div class="label-with-tooltip">
              <label class="input-label">Max Boost (dB)</label>
              <TooltipIcon text="Ceiling on how much the curve may lift any band. Boosts amplify whatever sits under the signal too, so keep this modest." />
            </div>
            <input
              type="number"
              :value="store.toneMatchConfig.maxBoostDb"
              min="0" max="36" step="1"
              class="input-number"
              @change="store.setToneMatchConfig({ maxBoostDb: Number(($event.target as HTMLInputElement).value) })"
            />
          </div>

          <div class="control-row">
            <div class="label-with-tooltip">
              <label class="input-label">Max Cut (dB)</label>
              <TooltipIcon text="Ceiling on how much the curve may attenuate any band. Cuts don't raise noise, so this can sit higher than Max Boost." />
            </div>
            <input
              type="number"
              :value="store.toneMatchConfig.maxCutDb"
              min="0" max="48" step="1"
              class="input-number"
              @change="store.setToneMatchConfig({ maxCutDb: Number(($event.target as HTMLInputElement).value) })"
            />
          </div>

          <div class="control-row">
            <div class="label-with-tooltip">
              <label class="input-label">Smoothing</label>
              <TooltipIcon text="Fractional-octave width the two spectra are smoothed to before they're compared. Wider follows broad tonal shape; narrower chases individual resonances and picks up more noise." />
            </div>
            <select :value="store.toneMatchConfig.smoothingOctave" class="input-select" @change="store.setToneMatchConfig({ smoothingOctave: Number(($event.target as HTMLSelectElement).value) })">
              <option :value="1 / 3">1/3 octave</option>
              <option :value="1 / 6">1/6 octave</option>
              <option :value="1 / 12">1/12 octave</option>
              <option :value="1 / 24">1/24 octave</option>
            </select>
          </div>

          <div class="control-row control-row-stacked">
            <div class="label-with-tooltip">
              <label class="input-label">Match Band (Hz)</label>
              <TooltipIcon text="Correction applies in full inside this band and tapers to 0 dB an octave beyond each edge. Outside it both takes are mostly their own noise floor, so their ratio is meaningless." />
            </div>
            <div class="input-pair">
              <input
                type="number"
                :value="store.toneMatchConfig.matchLowHz"
                min="10" max="500" step="5"
                class="input-number"
                @change="store.setToneMatchConfig({ matchLowHz: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="input-sep">to</span>
              <input
                type="number"
                :value="store.toneMatchConfig.matchHighHz"
                min="1000" max="22000" step="500"
                class="input-number"
                @change="store.setToneMatchConfig({ matchHighHz: Number(($event.target as HTMLInputElement).value) })"
              />
            </div>
          </div>

          <div class="control-row control-row-stacked">
            <div class="label-with-tooltip">
              <label class="input-label">SNR Gate (dB)</label>
              <TooltipIcon text="Bins this close to their own take's noise floor get no correction, and full correction once this far above it. The gate may alter the result. Defaults −200 / −199 (off); set 3 / 12 to enable noise rejection." />
            </div>
            <div class="input-pair">
              <input
                type="number"
                :value="store.toneMatchConfig.snrFloorDb"
                min="-200" max="60" step="1"
                class="input-number"
                @change="store.setToneMatchConfig({ snrFloorDb: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="input-sep">to</span>
              <input
                type="number"
                :value="store.toneMatchConfig.snrFullDb"
                min="-199" max="60" step="1"
                class="input-number"
                @change="store.setToneMatchConfig({ snrFullDb: Number(($event.target as HTMLInputElement).value) })"
              />
            </div>
          </div>

        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import Icon from './Icon.vue';
import TooltipIcon from './TooltipIcon.vue';

const store = useAnalysisStore();
const open = ref(false);
</script>

<style lang="scss" scoped>
@use '../styles/variables' as *;
@use '../styles/mixins' as *;

.advanced-settings {
  overflow: hidden;
}

.toggle-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: var(--font-size-label);
  font-weight: 500;
  transition: color $transition-fast;

  &:hover {
    color: var(--color-accent);
  }
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toggle-chevron {
  flex-shrink: 0;
  transition: transform $transition-base;
}

.settings-body {
  padding: 8px 0 0 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  @include caps-label;
}

// Single-control rows sit inline: label left, control right.
.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

// The two-value rows can't fit label + both inputs on one line at this width, so
// the label takes its own line and the pair sits beneath it.
.control-row-stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;

  // Column direction, so the label would otherwise stretch the full row width.
  .label-with-tooltip { align-self: flex-start; }
}

.input-label {
  font-size: var(--font-size-micro);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.label-with-tooltip {
  display: flex;
  align-items: center;
  gap: 4px;
  // Let the label give way first: the controls to its right are fixed-width, and
  // the panel is only ~284px wide once the IR panel's padding is taken off.
  min-width: 0;
  flex-shrink: 1;

  .info-icon { flex-shrink: 0; }
}

.input-select,
.input-number {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background-color: var(--color-bg);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: inherit;
  transition: border-color $transition-fast;
  flex-shrink: 0;

  &:hover { border-color: var(--color-text-secondary); }
  &:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
}

// Single controls share one right edge.
.control-row > .input-select,
.control-row > .input-number {
  width: 116px;
}

// Full width of the stacked row, split evenly between the two values.
.input-pair {
  display: flex;
  align-items: center;
  gap: 6px;

  // flex:1 also clears the flex-shrink:0 the shared input rule sets.
  .input-number {
    flex: 1 1 0;
    min-width: 0;
  }
}

.input-sep {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.divider {
  height: 1px;
  background-color: var(--color-border);
}

</style>
