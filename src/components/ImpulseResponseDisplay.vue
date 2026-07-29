<template>
  <div class="ir-display">
    <div class="section-header">
      <label class="section-title">Impulse Response</label>
      <TooltipIcon text="The derived filter that transforms Wave 1 into Wave 2's tonal character. Export as a WAV convolution IR or copy raw JSON." />
      <Icon v-if="store.ir" name="check" size="16" />
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
        <Transition name="fade-rise">
          <div v-if="!store.ir" class="overlay">
            <p>Derive IR to display</p>
          </div>
        </Transition>
      </div>

      <Transition name="fade-rise">
      <div v-if="store.ir" class="ir-populated">
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
        <label class="meta-label">Format</label>
        <select v-model="format" class="input-select">
          <option :value="24">24-bit</option>
          <option :value="16">16-bit</option>
          <option value="float32">32-bit float</option>
        </select>
      </div>

      <div class="actions">
        <button @click="downloadIR(48000)" class="btn btn-secondary" title="Download IR as 48 kHz WAV">
          <Icon name="download-cloud" size="16" />
          48 kHz
        </button>
        <button @click="downloadIR(44100)" class="btn btn-secondary" title="Download IR as 44.1 kHz WAV">
          <Icon name="download-cloud" size="16" />
          44.1 kHz
        </button>
        <button @click="copyToClipboard" class="btn btn-secondary" title="Copy JSON to clipboard">
          <Icon name="copy" size="16" />
          JSON
        </button>
      </div>
      </div>
      </Transition>
    </div>

    <AdvancedSettings />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';
import { peak } from '../utils/mathUtils';
import { encodeWavPcm, encodeWavFloat32, downloadFile } from '../utils/fileUtils';
import type { ExportFormat } from '../utils/fileUtils';
import { irMagnitudeResponse } from '../services/dsp/irResponse';
import type { IrMagnitudeResponse } from '../services/dsp/irResponse';
import Icon from './Icon.vue';
import TooltipIcon from './TooltipIcon.vue';
import AdvancedSettings from './AdvancedSettings.vue';

const store = useAnalysisStore();
const canvas = ref<HTMLCanvasElement>();
const canvasWidth = ref(280);
const canvasHeight = ref(120);
const peakAmplitude = ref(0);
const format = ref<ExportFormat>(24);

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

  // Clear canvas completely, then redraw background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(26, 26, 26, 1)';
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

  drawResponseOverlay(ctx, w, h, centerY);
  drawWaveform(ctx, ir, w, h, centerY);

  logger.debug('ImpulseResponseDisplay', 'IR drawn', { samples: ir.length });
}

/**
 * Time-domain shape, peak-normalized to fill the same vertical bounds the spectrum uses.
 * Filled rather than stroked so it reads as a solid mass under the spectrum's outline,
 * with opacity keeping the spectrum curve visible through it.
 */
function drawWaveform(
  ctx: CanvasRenderingContext2D,
  ir: Float32Array,
  w: number,
  h: number,
  centerY: number,
): void {
  const halfHeight = h / 2 - 2;
  const maxPeakVal = peak(ir);

  const tops: number[] = [];
  for (let i = 0; i < w; i++) {
    const idx = Math.floor((i / w) * ir.length);
    const sample = ir[Math.min(idx, ir.length - 1)] || 0;
    tops.push(centerY - (sample / (maxPeakVal || 1)) * halfHeight);
  }

  ctx.beginPath();
  ctx.moveTo(0, centerY);
  tops.forEach((y, i) => ctx.lineTo(i, y));
  ctx.lineTo(w - 1, centerY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fill();
}

/**
 * Filled, translucent magnitude response, 20 Hz to Nyquist on a log x-axis with 0 dB on
 * the canvas centre line — so a boost fills upward and a cut downward from the same line
 * the waveform is drawn around.
 */
function drawResponseOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  centerY: number,
): void {
  if (!store.ir) return;

  // Shorter FFT than the plot uses: at 280 px wide the extra resolution is invisible.
  const response = irMagnitudeResponse(store.ir, 4096);
  const nyquist = store.ir.sampleRate / 2;
  const logMin = Math.log10(20);
  const logMax = Math.log10(nyquist);
  const span = Math.max(6, response.maxAbsDb * 1.15);
  const halfHeight = h / 2 - 2;

  const points: Array<[number, number]> = [];
  for (let x = 0; x <= w; x++) {
    const hz = Math.pow(10, logMin + (x / w) * (logMax - logMin));
    const db = responseDbAt(response, hz);
    points.push([x, centerY - (db / span) * halfHeight]);
  }

  ctx.beginPath();
  ctx.moveTo(points[0][0], centerY);
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.lineTo(points[points.length - 1][0], centerY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(139, 92, 246, 0.18)';
  ctx.fill();

  // Stroke the curve on its own, so the polygon's baseline edges stay invisible.
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.strokeStyle = 'rgba(139, 92, 246, 0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Linear interpolation into the response's uniformly spaced bins, held flat past the ends. */
function responseDbAt(response: IrMagnitudeResponse, frequency: number): number {
  const { frequencies, magnitudesDb } = response;
  const spacing = frequencies[0] || 1;
  // frequencies[0] is bin 1, so index 0 sits one bin above DC.
  const position = frequency / spacing - 1;

  if (position <= 0) return magnitudesDb[0];
  if (position >= magnitudesDb.length - 1) return magnitudesDb[magnitudesDb.length - 1];

  const index = Math.floor(position);
  const fraction = position - index;
  return magnitudesDb[index] + (magnitudesDb[index + 1] - magnitudesDb[index]) * fraction;
}

// Peaks are often well below 0.001, where toFixed(3) would just render "0.000"
function formatPeak(value: number): string {
  if (value === 0) return '0';
  return value >= 0.001 ? value.toFixed(3) : value.toExponential(2);
}

/**
 * Export at the requested rate by *rendering a new filter at that rate*, not by resampling
 * the one on screen.
 *
 * Resampling an impulse response is the trap: linear interpolation is a triangular kernel,
 * so its response is sinc²(f·T) — 1.5 dB down at 10 kHz and 6.3 dB down at 20 kHz — and
 * re-trimming the stretched result back to a power of two then cut off the tail and its
 * fade. Re-rendering from the cached tone curve has none of that: the curve has no rate of
 * its own, so 48 kHz is just as native as 44.1 kHz.
 */
function downloadIR(targetRate: number): void {
  const rendered = store.renderIRAt(targetRate, store.irTaps);
  if (!rendered) return;

  const samples = rendered.coefficients;
  const wav =
    format.value === 'float32'
      ? encodeWavFloat32(samples, targetRate)
      : encodeWavPcm(samples, targetRate, format.value);

  const rateLabel = targetRate === 44100 ? '44k1' : `${Math.round(targetRate / 1000)}k`;
  const depthLabel = format.value === 'float32' ? 'f32' : `${format.value}bit`;
  downloadFile(wav, `tone-match-${samples.length}-${rateLabel}-${depthLabel}.wav`, 'audio/wav');

  logger.info('ImpulseResponseDisplay', 'Exported IR as WAV', {
    derivedAtRate: store.ir?.sampleRate,
    targetRate,
    format: format.value,
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

<style lang="scss" scoped>
@use '../styles/variables' as *;
@use '../styles/mixins' as *;

$gap: 12px;

.ir-display {
  display: flex;
  flex-direction: column;
  gap: $gap;
  flex: 0 0 auto;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  @include caps-label;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-bg);
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
}

.ir-populated {
  display: flex;
  flex-direction: column;
  gap: $gap;
}

.fade-rise-enter-active {
  animation: slideIn $transition-base ease-out;
}

.fade-rise-leave-active {
  transition: opacity $transition-fast;
}

.fade-rise-leave-to {
  opacity: 0;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ir-content {
  display: flex;
  flex-direction: column;
  gap: $gap;
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
  background-color: color-mix(in srgb, var(--color-accent) 5%, transparent);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-label);
}

.meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.meta-label {
  @include caps-label;
}

.meta-value {
  font-family: var(--font-body);
  color: var(--color-accent);
  font-weight: 600;
}

.control-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-select {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-bg);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: var(--font-body);
  transition: border-color $transition-fast;

  &:hover { border-color: var(--color-text-secondary); }
  &:focus {
    border-color: var(--color-accent);
    outline: none;
  }
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
  font-size: var(--font-size-label);
  font-weight: 600;
  cursor: pointer;
  transition: all $transition-fast;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;

  &-secondary {
    background-color: var(--color-border);
    color: var(--color-text-primary);

    &:hover {
      filter: brightness(0.9);
    }
  }
}

.value {
  color: var(--color-success);
  font-size: var(--font-size-sm);
  font-weight: 600;
}
</style>
