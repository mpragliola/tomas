<template>
  <div class="control-panel">
    <!-- Compute Buttons - TOP (Horizontal) -->
    <div class="compute-buttons">
      <button
        @click="computeSpectra"
        class="btn-icon-text"
        :disabled="isComputing"
        title="Compute Spectrum"
      >
        📊
      </button>

      <button
        @click="computeIR"
        class="btn-icon-text"
        :disabled="isComputing || !store.spectra.A"
        title="Derive IR"
      >
        🔧
      </button>

      <button
        @click="applyIR"
        class="btn-icon-text"
        :disabled="isComputing || !store.ir"
        title="Apply IR"
      >
        ✓
      </button>
    </div>

    <!-- Status -->
    <div v-if="statusMessage" class="status-message">
      {{ statusMessage }}
    </div>

    <!-- Advanced Settings Toggle -->
    <button class="settings-toggle" @click="showAdvanced = !showAdvanced">
      {{ showAdvanced ? '▼' : '▶' }} Advanced Settings
    </button>

    <template v-if="showAdvanced">
      <div class="divider"></div>

      <div class="section">
      <div class="section-header">
        <label class="section-title">FFT Settings</label>
      </div>

      <!-- FFT Size -->
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

      <!-- Window Function -->
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

    <div class="section">
      <div class="section-header">
        <label class="section-title">Tone Match (A → B)</label>
      </div>

      <!-- Taps -->
      <div class="control-row">
        <label class="input-label">IR Length (taps)</label>
        <select v-model.number="taps" class="input-select">
          <option value="512">512</option>
          <option value="1024">1024</option>
          <option value="2048">2048</option>
          <option value="4096">4096</option>
        </select>
      </div>

      <!-- Max boost -->
      <div class="control-row">
        <label class="input-label">Max Boost / Cut (dB)</label>
        <input
          type="number"
          v-model.number="maxBoostDb"
          min="3"
          max="36"
          step="1"
          class="input-number"
        />
      </div>

      <!-- Smoothing -->
      <div class="control-row">
        <label class="input-label">Smoothing</label>
        <select v-model.number="smoothingOctave" class="input-select">
          <option :value="1 / 3">1/3 octave</option>
          <option :value="1 / 6">1/6 octave</option>
          <option :value="1 / 12">1/12 octave</option>
          <option :value="1 / 24">1/24 octave</option>
        </select>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';
import type { FFTConfig } from '../types/spectrum';

const store = useAnalysisStore();
const fftSize = ref<512 | 1024 | 2048 | 4096 | 8192 | 16384>(2048);
const window = ref<'hann' | 'hamming' | 'rectangular'>('hann');
const taps = ref(2048);
const maxBoostDb = ref(18);
const smoothingOctave = ref(1 / 6);
const isComputing = ref(false);
const statusMessage = ref('');
const showAdvanced = ref(false);

const emit = defineEmits<{
  'params-changed': [params: any];
}>();

async function computeSpectra(): Promise<void> {
  if (store.audioBuffers.A.length === 0 || store.audioBuffers.B.length === 0) {
    logger.warn('ControlPanel', 'Both audio files required');
    statusMessage.value = 'Load both audio files first';
    return;
  }

  isComputing.value = true;
  statusMessage.value = 'Computing spectra... (FFT may take a moment)';

  try {
    const startTime = Date.now();
    const config: FFTConfig = {
      fftSize: fftSize.value,
      window: window.value,
      overlap: 0.5,
    };

    await store.computeSpectra(config);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    statusMessage.value = `Spectra computed in ${elapsed}s ✓`;
    logger.info('ControlPanel', 'Spectra computed', { elapsedSeconds: elapsed });
    emit('params-changed', { action: 'spectra-computed' });

    setTimeout(() => {
      statusMessage.value = '';
    }, 3000);
  } catch (error) {
    logger.error('ControlPanel', 'Failed to compute spectra', { error: String(error) });
    statusMessage.value = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    isComputing.value = false;
  }
}

async function computeIR(): Promise<void> {
  if (!store.spectra.A || !store.spectra.B) {
    logger.warn('ControlPanel', 'Spectra required');
    statusMessage.value = 'Compute spectra first';
    return;
  }

  isComputing.value = true;
  statusMessage.value = 'Deriving IR...';

  try {
    await store.computeToneMatchIR({
      taps: taps.value,
      maxBoostDb: maxBoostDb.value,
      smoothingOctave: smoothingOctave.value,
    });
    statusMessage.value = `IR derived ✓ (${store.ir?.length} taps)`;
    logger.info('ControlPanel', 'IR computed');
    emit('params-changed', { action: 'ir-computed' });

    setTimeout(() => {
      statusMessage.value = '';
    }, 2000);
  } catch (error) {
    logger.error('ControlPanel', 'Failed to compute IR', { error: String(error) });
    statusMessage.value = 'Error computing IR';
  } finally {
    isComputing.value = false;
  }
}

async function applyIR(): Promise<void> {
  if (!store.ir) {
    logger.warn('ControlPanel', 'IR required');
    statusMessage.value = 'Derive IR first';
    return;
  }

  isComputing.value = true;
  statusMessage.value = 'Applying IR...';

  try {
    await store.applyIR();
    statusMessage.value = 'IR applied ✓';
    logger.info('ControlPanel', 'IR applied');
    emit('params-changed', { action: 'ir-applied' });

    setTimeout(() => {
      statusMessage.value = '';
    }, 2000);
  } catch (error) {
    logger.error('ControlPanel', 'Failed to apply IR', { error: String(error) });
    statusMessage.value = 'Error applying IR';
  } finally {
    isComputing.value = false;
  }
}
</script>

<style scoped>
.control-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: visible;
  flex-shrink: 0;
  min-height: auto;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.control-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-label {
  font-size: 10px;
  font-weight: 500;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.input-select,
.input-number {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-bg);
  color: var(--color-text-primary);
  font-size: 12px;
  font-family: var(--font-body);
  transition: border-color 150ms;
}

.input-select:focus,
.input-number:focus {
  border-color: var(--color-accent);
  outline: none;
}

.input-select:hover,
.input-number:hover {
  border-color: var(--color-text-secondary);
}

.btn {
  padding: 8px;
  border: none;
  border-radius: var(--radius-lg);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.btn-primary {
  background-color: var(--color-accent);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn-primary:active:not(:disabled) {
  filter: brightness(0.95);
}

.btn-secondary {
  background-color: var(--color-border);
  color: var(--color-text-primary);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--color-text-secondary);
  color: white;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.divider {
  height: 1px;
  background-color: var(--color-border);
}

.compute-buttons {
  display: flex;
  gap: 8px;
}

.btn-icon-text {
  flex: 1;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-accent);
  color: white;
  font-size: 18px;
  cursor: pointer;
  transition: all 150ms;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-icon-text:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn-icon-text:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.settings-toggle {
  width: 100%;
  padding: 6px;
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms;
  text-align: left;
}

.settings-toggle:hover {
  background-color: rgba(37, 99, 235, 0.05);
  border-color: var(--color-accent);
}

.status-message {
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background-color: rgba(37, 99, 235, 0.1);
  border: 1px solid var(--color-accent);
  color: var(--color-accent);
  font-size: 10px;
  font-weight: 500;
  text-align: center;
  animation: slideIn 200ms ease-out;
  margin-top: 4px;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
