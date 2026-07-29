<template>
  <div class="recording-panel">
    <div class="section">
      <div class="section-header">
        <label class="section-title">Recording</label>
      </div>

      <!-- Input Device Selector -->
      <div class="device-select">
        <label class="input-label">Input device</label>
        <select v-model="selectedDeviceId" :disabled="isRecording" class="device-dropdown">
          <option value="">System default</option>
          <option v-for="d in devices" :key="d.deviceId" :value="d.deviceId">{{ d.label }}</option>
        </select>
      </div>

      <!-- Channel picker: takes are mono, so one channel of the device is kept -->
      <div class="device-select">
        <label class="input-label">Input channel</label>
        <select
          v-model.number="channelIndex"
          :disabled="isRecording || channelCount < 2"
          class="device-dropdown"
        >
          <option v-for="n in channelCount" :key="n" :value="n - 1">
            Channel {{ n }}{{ channelCount === 2 ? (n === 1 ? ' (left)' : ' (right)') : '' }}
          </option>
        </select>
        <span class="device-hint">
          {{ channelCount < 2 ? 'Device is mono' : `${channelCount} channels available` }} — takes
          are mono, the picked channel is kept as-is (never summed)
        </span>
      </div>

      <!-- Stop Recording Button (only when recording) -->
      <button
        v-if="isRecording"
        type="button"
        class="btn-stop"
        @click="stopRecording"
      >
        ⏹ Stop — Wave {{ activeSlot === 'A' ? 1 : 2 }}
      </button>

      <!-- Level Meter -->
      <div class="level-meter">
        <div class="level-label">Level</div>
        <div class="level-display">
          <svg
            class="vu-meter"
            viewBox="0 0 120 70"
            preserveAspectRatio="xMidYMid meet"
            :style="autoTriggerEnabled ? 'cursor: ew-resize' : ''"
            @pointerdown="onArcPointerDown"
            @pointermove="onArcPointerMove"
            @pointerup="onArcPointerUp"
            @pointercancel="onArcPointerUp"
          >
            <!-- Background arc (also acts as click target) -->
            <path
              d="M 15,60 A 45,45 0 0,1 105,60"
              stroke="var(--color-border)"
              stroke-width="8"
              fill="none"
              stroke-linecap="butt"
            />
            <!-- Arc fill (current level) -->
            <path
              :d="getArcPath(isMonitoring ? monitorLevelDb : currentLevelDb)"
              :stroke="(isMonitoring ? monitorLevelDb : currentLevelDb) > -6 ? '#FF3B30' : 'var(--color-accent)'"
              stroke-width="8"
              fill="none"
              stroke-linecap="butt"
            />
            <!-- Clipping indicator if level exceeds -6dB -->
            <circle
              v-if="(isMonitoring ? monitorLevelDb : currentLevelDb) > -6"
              cx="105"
              cy="60"
              r="4"
              fill="#FF3B30"
              opacity="0.8"
            />
            <!-- Auto-trigger threshold notch -->
            <line
              v-if="autoTriggerEnabled"
              :x1="thresholdNotch.x1"
              :y1="thresholdNotch.y1"
              :x2="thresholdNotch.x2"
              :y2="thresholdNotch.y2"
              stroke="#FF9500"
              stroke-width="2"
              stroke-linecap="butt"
            />
            <!-- Tick marks -->
            <text x="12" y="68" font-size="9" font-weight="500" fill="var(--color-text-secondary)">-60</text>
            <text x="100" y="68" font-size="9" font-weight="500" fill="var(--color-text-secondary)">0</text>
          </svg>
          <div class="level-value">{{ (isMonitoring ? monitorLevelDb : currentLevelDb).toFixed(1) }}dB</div>
        </div>
        <button
          type="button"
          class="btn-monitor"
          :class="{ active: isMonitoring }"
          :disabled="isRecording"
          @click="toggleMonitor"
        >
          {{ isMonitoring ? '⏹ Stop monitor' : '🎧 Monitor' }}
        </button>
      </div>

      <Transition name="fade-rise">
        <div v-if="statusMessage" class="status-message">
          {{ statusMessage }}
        </div>
      </Transition>

      <div v-if="isArmed" class="armed-message">
        Armed — waiting for a peak above {{ thresholdDb }}dB
      </div>

      <!-- Duration Display -->
      <div class="duration">
        <div class="duration-time">{{ formatDurationMs(recordedDuration) }}</div>
        <div class="duration-max">/ {{ formatDurationMs(maxDuration) }}</div>
      </div>

      <!-- Auto-trigger Controls -->
      <div class="divider"></div>

      <div class="auto-trigger">
        <div class="auto-trigger-header">
          <label class="input-label">
            <input
              type="checkbox"
              v-model="autoTriggerEnabled"
              @change="updateAutoTrigger"
            />
            Auto-trigger
          </label>
          <TooltipIcon text="Starts recording automatically when the input level crosses the threshold, then stops once the signal drops away." />
        </div>

        <div v-if="autoTriggerEnabled" class="auto-trigger-controls">
          <div class="slider-group">
            <label class="value-label">Threshold</label>
            <input
              type="range"
              min="-60"
              max="-10"
              v-model.number="thresholdDb"
              @change="updateThreshold"
              class="slider"
            />
            <div class="slider-value">{{ thresholdDb }}dB</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import TooltipIcon from './TooltipIcon.vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';
import type { RecorderConfig, SlotId } from '../types/audio';
import { MIN_ANALYSIS_SECONDS } from '../services/dsp/defaults';
import { useAudioDevices } from '../composables/useAudioDevices';
import { useMonitor } from '../composables/useMonitor';
import { getArcPath, getThresholdNotch, arcDbFromPointer } from '../utils/vuMeter';
import { formatDurationMs } from '../utils/audioFormat';

const store = useAnalysisStore();
const isRecording = ref(false);
const currentLevelDb = ref(-60);
const recordedDuration = ref(0);
const maxDuration = ref(20000);
const autoTriggerEnabled = ref(false);
/** Stream open, metering, but holding capture until the threshold is crossed. */
const isArmed = ref(false);
const thresholdDb = ref(-40);
const activeSlot = ref<SlotId>('A');
const statusMessage = ref('');
let animationId: number | null = null;

const { devices, selectedDeviceId, channelCount, channelIndex, refreshChannels } = useAudioDevices(isRecording);
const { isMonitoring, currentLevelDb: monitorLevelDb, stopMonitor, toggleMonitor } = useMonitor(selectedDeviceId, channelIndex);

const thresholdNotch = computed(() => getThresholdNotch(thresholdDb.value));

let arcDragging = false;

function onArcPointerDown(event: PointerEvent): void {
  if (!autoTriggerEnabled.value) return;
  const dB = arcDbFromPointer(event);
  if (dB === null) return;
  arcDragging = true;
  (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
  thresholdDb.value = Math.max(-60, Math.min(-10, dB));
}

function onArcPointerMove(event: PointerEvent): void {
  if (!arcDragging) return;
  const dB = arcDbFromPointer(event);
  if (dB === null) return;
  thresholdDb.value = Math.max(-60, Math.min(-10, dB));
}

function onArcPointerUp(event: PointerEvent): void {
  if (!arcDragging) return;
  arcDragging = false;
  (event.currentTarget as SVGSVGElement).releasePointerCapture(event.pointerId);
}

const emit = defineEmits<{
  'recorded': [{ slot: SlotId; samples: number }];
}>();

async function startRecording(slot: SlotId = 'A'): Promise<void> {
  if (isRecording.value) return;
  if (isMonitoring.value) stopMonitor();

  try {
    const config: RecorderConfig = {
      sampleRate: 44100,
      maxDuration: maxDuration.value,
      channelCount: 1,
      channelIndex: channelIndex.value,
      autoThreshold: thresholdDb.value,
      autoTrigger: autoTriggerEnabled.value,
      deviceId: selectedDeviceId.value || undefined,
    };

    statusMessage.value = '';
    await store.recordAudio(config, slot);
    activeSlot.value = slot;
    isRecording.value = true;
    recordedDuration.value = 0;

    // The device only reports what it really gave once it is open — a pick the probe
    // allowed but the stream did not deliver must not pass for the channel it isn't
    const state = store.recorder.getState();
    channelCount.value = state.inputChannels;
    if (state.channelIndex !== channelIndex.value) {
      channelIndex.value = state.channelIndex;
      statusMessage.value =
        `Device opened with ${state.inputChannels} channel(s) — recording channel ` +
        `${state.channelIndex + 1}`;
    }

    animationId = setInterval(updateMeters, 50);
    logger.info('RecordingPanel', 'Recording started', { slot });
  } catch (error) {
    logger.error('RecordingPanel', 'Failed to start recording', { error: String(error) });
    isRecording.value = false;
  }
}

async function stopRecording(): Promise<void> {
  // Stop can arrive twice — from the slot button and from the meter poll noticing
  // that capture already ended
  if (!isRecording.value) return;
  isRecording.value = false;

  if (animationId !== null) {
    clearInterval(animationId);
    animationId = null;
  }
  isArmed.value = false;

  const slot = activeSlot.value;

  try {
    await store.stopRecording(slot);

    const samples = store.audioBuffers[slot].length;
    // The spectrum is auto-computed on save; if it did not land, the take was
    // rejected as too short and nothing downstream would have run
    statusMessage.value = store.spectra[slot]
      ? ''
      : `Take too short to analyse — record at least ${MIN_ANALYSIS_SECONDS}s`;
    emit('recorded', { slot, samples });

    logger.info('RecordingPanel', 'Recording stopped', { slot, samples });
  } catch (error) {
    logger.error('RecordingPanel', 'Failed to stop recording', { error: String(error) });
  } finally {
    // Always release the UI, otherwise a failed teardown leaves the panel
    // stuck showing Stop with no way back
    isRecording.value = false;
  }
}

function updateMeters(): void {
  try {
    const state = store.recorder.getState();
    currentLevelDb.value = 20 * Math.log10(Math.max(state.level, 1e-10));
    recordedDuration.value = state.recordedDuration;
    isArmed.value = state.isArmed;

    // Capture can end by itself (auto-stop, max duration) — finish the take
    // so the audio is saved and the mic is released
    if (!state.isRecording) {
      logger.info('RecordingPanel', 'Capture ended on its own, finalizing');
      void stopRecording();
    }
  } catch (e) {
    // recorder not initialized
  }
}

function updateAutoTrigger(): void {
  logger.debug('RecordingPanel', 'Auto-trigger toggled', { enabled: autoTriggerEnabled.value });
}

function updateThreshold(): void {
  logger.debug('RecordingPanel', 'Threshold updated', { dB: thresholdDb.value });
}

onUnmounted(() => {
  if (isRecording.value) stopRecording();
});

defineExpose({
  startRecording,
  stopRecording,
});
</script>

<style lang="scss" scoped>
@use '../styles/variables' as *;
@use '../styles/mixins' as *;

@mixin danger-action {
  background-color: var(--color-error);
  color: var(--color-accent-text);
  border: none;
  padding: 10px;
  border-radius: var(--radius-lg);
  font-size: var(--font-size-base);
  font-weight: 600;
  cursor: pointer;
  transition: all $transition-fast;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  &:hover  { filter: brightness(1.1); }
  &:active { filter: brightness(0.95); }
}

.recording-panel {
  display: flex;
  flex-direction: column;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title { @include caps-label; }

.device-select {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.device-dropdown {
  width: 100%;
  padding: 6px 8px;
  font-size: var(--font-size-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background-color: var(--color-bg);
  color: var(--color-text-primary);

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.device-hint {
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
  opacity: 0.8;
}

.btn-stop {
  @include danger-action;
  width: 100%;
  animation: pulse-record 1s infinite;
}

@keyframes pulse-record {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.7; }
}

.armed-message {
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background-color: color-mix(in srgb, var(--color-warning) 12%, transparent);
  border: 1px solid var(--color-warning);
  color: var(--color-warning);
  font-size: var(--font-size-label);
  font-weight: 500;
  text-align: center;
}

.status-message {
  padding: 8px;
  border-radius: var(--radius-sm);
  background-color: color-mix(in srgb, var(--color-error) 10%, transparent);
  border: 1px solid var(--color-error);
  color: var(--color-error);
  font-size: var(--font-size-label);
  font-weight: 500;
  text-align: center;
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

.level-meter {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.level-label { @include caps-label; }

.level-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.vu-meter {
  width: 100%;
  max-width: 200px;
  height: auto;
  aspect-ratio: calc(120 / 70);
}

.level-value {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-accent);
}

.duration {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
}

.duration-time {
  font-family: var(--font-mono);
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-accent);
}

.duration-max {
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
}

.divider {
  height: 1px;
  background-color: var(--color-border);
}

.auto-trigger {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.auto-trigger-header {
  display: flex;
  align-items: center;
  gap: 6px;

  input {
    margin-right: 6px;
    cursor: pointer;
  }

  label {
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
  }
}

.auto-trigger-controls {
  padding: 8px;
  background-color: color-mix(in srgb, var(--color-accent) 5%, transparent);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
}

.slider-group {
  display: flex;
  flex-direction: column;
  gap: 6px;

  input[type="range"] { width: 100%; }
}

.slider-value {
  font-size: var(--font-size-label);
  color: var(--color-accent);
  font-weight: 500;
  font-family: var(--font-mono);
  text-align: right;
}

.input-label { @include caps-label; }

.value-label {
  @include caps-label(10px);
  font-family: var(--font-body);
}

.btn-monitor {
  background-color: transparent;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-label);
  font-weight: 500;
  cursor: pointer;
  transition: all $transition-fast;
  width: 100%;

  &:hover:not(:disabled) {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  &.active {
    background-color: color-mix(in srgb, var(--color-accent) 10%, transparent);
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}
</style>
