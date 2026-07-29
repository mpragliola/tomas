<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Advanced Settings</h2>
        <button class="close-btn" title="Close" aria-label="Close" @click="$emit('close')">
          <Icon name="x" size="24" />
        </button>
      </div>

      <div class="modal-body">
        <!-- FFT Settings -->
        <div class="section">
          <div class="section-header">
            <label class="section-title">FFT Settings</label>
          </div>

          <div class="control-row">
            <label class="input-label">FFT Size</label>
            <select v-model.number="fftSize" class="input-select">
              <option value="512">512</option>
              <option value="1024">1024</option>
              <option value="2048">2048</option>
              <option value="4096">4096</option>
              <option value="8192">8192</option>
              <option value="16384">16384</option>
            </select>
          </div>

          <div class="control-row">
            <label class="input-label">Window</label>
            <select v-model="window" class="input-select">
              <option value="hann">Hann</option>
              <option value="hamming">Hamming</option>
              <option value="rectangular">Rectangular</option>
            </select>
          </div>
        </div>

        <div class="divider"></div>

        <!-- Tone Match Settings -->
        <div class="section">
          <div class="section-header">
            <label class="section-title">Tone Match (A → B)</label>
          </div>

          <div class="control-row">
            <label class="input-label">Filter Taps</label>
            <input
              v-model.number="taps"
              type="number"
              min="256"
              max="8192"
              step="256"
              class="input-number"
            />
          </div>

          <div class="control-row">
            <label class="input-label">Max Boost (dB)</label>
            <input
              v-model.number="maxBoostDb"
              type="number"
              min="0"
              max="36"
              step="1"
              class="input-number"
            />
          </div>

          <div class="control-row">
            <label class="input-label">Max Cut (dB)</label>
            <input
              v-model.number="maxCutDb"
              type="number"
              min="0"
              max="48"
              step="1"
              class="input-number"
            />
          </div>

          <div class="control-row">
            <label class="input-label">Smoothing</label>
            <select v-model.number="smoothingOctave" class="input-select">
              <option :value="1 / 3">1/3 octave</option>
              <option :value="1 / 6">1/6 octave</option>
              <option :value="1 / 12">1/12 octave</option>
              <option :value="1 / 24">1/24 octave</option>
            </select>
          </div>

          <div class="control-row">
            <label class="input-label">Match Band (Hz)</label>
            <div class="input-pair">
              <input v-model.number="matchLowHz" type="number" min="10" max="500" step="5" class="input-number" />
              <span class="input-sep">to</span>
              <input v-model.number="matchHighHz" type="number" min="1000" max="22000" step="500" class="input-number" />
            </div>
          </div>
          <p class="hint">
            Outside this band both takes are mostly their own noise floor, so the ratio is
            meaningless — the correction tapers to 0 dB an octave beyond each edge.
          </p>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-primary" @click="save">Done</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Icon from './Icon.vue';
import { useAnalysisStore } from '../stores/analysisStore';
import type { FFTConfig } from '../types/spectrum';
import { DEFAULT_FFT_CONFIG, DEFAULT_TONE_MATCH_CONFIG } from '../services/dsp/defaults';

const store = useAnalysisStore();

const emit = defineEmits<{
  close: [];
}>();

const fftSize = ref<FFTConfig['fftSize']>(DEFAULT_FFT_CONFIG.fftSize);
const window = ref<FFTConfig['window']>(DEFAULT_FFT_CONFIG.window);
const taps = ref(DEFAULT_TONE_MATCH_CONFIG.taps);
const maxBoostDb = ref(DEFAULT_TONE_MATCH_CONFIG.maxBoostDb!);
const maxCutDb = ref(DEFAULT_TONE_MATCH_CONFIG.maxCutDb!);
const smoothingOctave = ref(DEFAULT_TONE_MATCH_CONFIG.smoothingOctave!);
const matchLowHz = ref(DEFAULT_TONE_MATCH_CONFIG.matchLowHz!);
const matchHighHz = ref(DEFAULT_TONE_MATCH_CONFIG.matchHighHz!);

onMounted(() => {
  taps.value = store.irTaps;
});

function save() {
  store.setIRTaps(taps.value);
  emit('close');
}
</script>

<style lang="scss" scoped>
@use '../styles/variables' as *;
@use '../styles/mixins' as *;

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
  max-width: 500px;
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

.modal-footer {
  padding: var(--space-5);
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.section {
  margin-bottom: var(--space-5);

  &-header { margin-bottom: 12px; }

  &-title {
    @include caps-label($weight: 600);
  }
}

.control-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.input-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text-primary);
}

.input-select,
.input-number {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background-color: var(--color-bg);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: inherit;

  &:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
}

.input-pair {
  display: flex;
  align-items: center;
  gap: 6px;

  .input-number { width: 84px; }
}

.input-sep {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.hint {
  margin: 4px 0 0;
  font-size: var(--font-size-label);
  line-height: 1.4;
  color: var(--color-text-secondary);
}

.divider {
  height: 1px;
  background-color: var(--color-border);
  margin: var(--space-5) 0;
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
