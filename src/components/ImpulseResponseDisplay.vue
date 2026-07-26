<template>
  <div class="ir-display">
    <div class="section-header">
      <label class="section-title">Impulse Response</label>
      <span v-if="store.ir" class="value" style="font-size: 10px">✓</span>
    </div>

    <div v-if="!store.ir" class="empty-state">
      <p>Derive IR to display</p>
    </div>

    <div v-else class="ir-content">
      <!-- IR Waveform Canvas -->
      <div class="waveform-wrapper">
        <canvas
          ref="canvas"
          class="ir-canvas"
          :width="canvasWidth"
          :height="canvasHeight"
        ></canvas>
      </div>

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
          <span class="meta-value">{{ peakAmplitude.toFixed(3) }}</span>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="actions">
        <button @click="downloadIR" class="btn btn-secondary" title="Download IR as WAV">
          ⬇ Export WAV
        </button>
        <button @click="copyToClipboard" class="btn btn-secondary" title="Copy JSON to clipboard">
          📋 JSON
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';
import { peak } from '../utils/mathUtils';

const store = useAnalysisStore();
const canvas = ref<HTMLCanvasElement>();
const canvasWidth = ref(280);
const canvasHeight = ref(120);
const peakAmplitude = ref(0);

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
  () => {
    if (store.ir) {
      drawIR();
      peakAmplitude.value = peak(store.ir.coefficients);
      emit('ir-derived', { length: store.ir.length });
    }
  }
);

function drawIR(): void {
  if (!canvas.value || !store.ir) return;

  const ctx = canvas.value.getContext('2d');
  if (!ctx) return;

  const ir = store.ir.coefficients;
  const w = canvas.value.width;
  const h = canvas.value.height;
  const centerY = h / 2;

  // Clear canvas
  ctx.fillStyle = 'rgba(26, 26, 26, 0.5)';
  ctx.fillRect(0, 0, w, h);

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

  // Draw waveform
  const maxPeakVal = Math.max(...Array.from(ir).map(Math.abs));
  ctx.strokeStyle = 'var(--color-accent)';
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

function downloadIR(): void {
  if (!store.ir) return;

  logger.info('ImpulseResponseDisplay', 'Exporting IR as WAV');

  const sampleRate = store.ir.sampleRate;
  const pcm = store.ir.coefficients;

  // Create WAV file
  const numChannels = 1;
  const bitsPerSample = 32;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = pcm.length * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM data
  for (let i = 0; i < pcm.length; i++) {
    view.setFloat32(44 + i * 4, pcm[i], true);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ir.wav';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 150px;
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
