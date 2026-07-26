<template>
  <div class="ir-display">
    <div class="section-header">
      <label class="section-title">Impulse Response</label>
      <span v-if="store.ir" class="value" style="font-size: 10px">✓</span>
    </div>

    <!-- Canvas stays mounted so the ref is always valid; empty state overlays it -->
    <div class="ir-content">
      <!-- IR Waveform Canvas -->
      <div class="waveform-wrapper">
        <canvas
          ref="canvas"
          class="ir-canvas"
          :width="canvasWidth"
          :height="canvasHeight"
        ></canvas>
        <div v-if="!store.ir" class="overlay">
          <p>Derive IR to display</p>
        </div>
      </div>

      <template v-if="store.ir">
      <!-- Metadata -->
      <div class="metadata">
        <div class="meta-row">
          <span class="meta-label">Length</span>
          <span class="meta-value">{{ store.ir.length }} samples</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Duration</span>
          <span class="meta-value">{{ (store.ir.length / store.ir.sampleRate).toFixed(3) }}s</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Sample Rate</span>
          <span class="meta-value">{{ store.ir.sampleRate }}Hz</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Peak</span>
          <span class="meta-value">{{ formatPeak(peakAmplitude) }}</span>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="control-row">
        <label class="meta-label">Bit Depth</label>
        <select v-model.number="bitDepth" class="input-select">
          <option value="24">24-bit</option>
          <option value="16">16-bit</option>
          <option value="8">8-bit</option>
        </select>
      </div>

      <div class="actions">
        <button @click="downloadIR(48000)" class="btn btn-secondary" title="Download IR as 48 kHz WAV">
          ⬇ 48 kHz
        </button>
        <button @click="downloadIR(44100)" class="btn btn-secondary" title="Download IR as 44.1 kHz WAV">
          ⬇ 44.1 kHz
        </button>
        <button @click="copyToClipboard" class="btn btn-secondary" title="Copy JSON to clipboard">
          📋 JSON
        </button>
      </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';
import { peak } from '../utils/mathUtils';
import { encodeWavPcm, downloadFile } from '../utils/fileUtils';
import type { PcmBitDepth } from '../utils/fileUtils';
import { resample } from '../services/audio/audioUtils';

const store = useAnalysisStore();
const canvas = ref<HTMLCanvasElement>();
const canvasWidth = ref(280);
const canvasHeight = ref(120);
const peakAmplitude = ref(0);
const bitDepth = ref<PcmBitDepth>(24);

const emit = defineEmits<{
  'ir-derived': [{ length: number }];
}>();

onMounted(() => {
  logger.info('ImpulseResponseDisplay', 'Mounted');
  if (store.ir) {
    drawIR();
  }
});

watch(
  () => store.ir,
  async () => {
    if (store.ir) {
      peakAmplitude.value = peak(store.ir.coefficients);
      emit('ir-derived', { length: store.ir.length });
    }
    await drawIR();
  }
);

async function drawIR(): Promise<void> {
  // Let any pending render flush before touching the canvas
  await nextTick();

  if (!canvas.value) return;

  const ctx = canvas.value.getContext('2d');
  if (!ctx) return;

  const w = canvas.value.width;
  const h = canvas.value.height;
  const centerY = h / 2;

  // Clear canvas
  ctx.fillStyle = 'rgba(26, 26, 26, 0.5)';
  ctx.fillRect(0, 0, w, h);

  if (!store.ir) return;
  const ir = store.ir.coefficients;

  // Draw grid
  ctx.strokeStyle = 'rgba(230, 230, 230, 0.1)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(w, centerY);
  ctx.stroke();

  // Draw zero line
  ctx.strokeStyle = 'rgba(153, 153, 153, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(w, centerY);
  ctx.stroke();

  // Draw waveform — canvas can't resolve CSS variables, so use the literal accent colour
  const maxPeakVal = peak(ir);
  ctx.strokeStyle = '#2563EB';
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let i = 0; i < w; i++) {
    const idx = Math.floor((i / w) * ir.length);
    const sample = ir[Math.min(idx, ir.length - 1)] || 0;
    const y = centerY - (sample / (maxPeakVal || 1)) * (h / 2 - 2);

    if (i === 0) {
      ctx.moveTo(i, y);
    } else {
      ctx.lineTo(i, y);
    }
  }
  ctx.stroke();

  logger.debug('ImpulseResponseDisplay', 'IR drawn', { samples: ir.length, peak: maxPeakVal });
}

/** Pad or trim to an exact tap count — IR loaders expect a power-of-two length. */
function fitToLength(samples: Float32Array, length: number): Float32Array {
  if (samples.length === length) return samples;
  const out = new Float32Array(length);
  out.set(samples.subarray(0, Math.min(samples.length, length)));
  return out;
}

// Peaks are often well below 0.001, where toFixed(3) would just render "0.000"
function formatPeak(value: number): string {
  if (value === 0) return '0';
  return value >= 0.001 ? value.toFixed(3) : value.toExponential(2);
}

function downloadIR(targetRate: number): void {
  if (!store.ir) return;

  const sourceRate = store.ir.sampleRate;
  // Resampling changes the tap count, so re-trim to the derived length that the
  // IR loader expects (a power of two).
  const resampled = resample(store.ir.coefficients, sourceRate, targetRate);
  const samples = fitToLength(resampled, store.ir.length);
  const wav = encodeWavPcm(samples, targetRate, bitDepth.value);

  const rateLabel = targetRate === 44100 ? '44k1' : `${Math.round(targetRate / 1000)}k`;
  downloadFile(wav, `tone-match-${samples.length}-${rateLabel}-${bitDepth.value}bit.wav`, 'audio/wav');

  logger.info('ImpulseResponseDisplay', 'Exported IR as WAV', {
    sourceRate,
    targetRate,
    bitDepth: bitDepth.value,
    taps: samples.length,
  });
}

function copyToClipboard(): void {
  if (!store.ir) return;

  const json = JSON.stringify({
    length: store.ir.length,
    sampleRate: store.ir.sampleRate,
    coefficients: Array.from(store.ir.coefficients),
  }, null, 2);

  navigator.clipboard.writeText(json).then(() => {
    logger.info('ImpulseResponseDisplay', 'IR JSON copied to clipboard');
  });
}
</script>

<style scoped>
.ir-display {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
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

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-bg);
  color: var(--color-text-secondary);
  font-size: 14px;
}

.ir-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.waveform-wrapper {
  position: relative;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background-color: rgba(26, 26, 26, 0.3);
}

.ir-canvas {
  width: 100%;
  height: 120px;
  display: block;
}

.metadata {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background-color: rgba(37, 99, 235, 0.05);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 11px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.meta-label {
  color: var(--color-text-secondary);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.meta-value {
  font-family: var(--font-mono);
  color: var(--color-accent);
  font-weight: 600;
}

.actions {
  display: flex;
  gap: 8px;
}

.btn {
  flex: 1;
  padding: 8px;
  border: none;
  border-radius: var(--radius-lg);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms;
}

.btn-secondary {
  background-color: var(--color-border);
  color: var(--color-text-primary);
}

.btn-secondary:hover {
  background-color: var(--color-text-secondary);
  color: white;
}

.value {
  color: var(--color-success);
  font-size: 12px;
  font-weight: 600;
}
</style>
