<template>
  <div class="recording-panel">
    <div class="section">
      <div class="section-header">
        <label class="section-title">Recording</label>
      </div>

      <!-- Stop Recording Button (only when recording) -->
      <button
        v-if="isRecording"
        type="button"
        class="btn-stop"
        @click="stopRecording"
      >
        ⏹ Stop
      </button>

      <!-- Level Meter -->
      <div class="level-meter">
        <div class="level-label">Level</div>
        <div class="level-display">
          <svg class="vu-meter" viewBox="0 0 120 70" preserveAspectRatio="xMidYMid meet">
            <!-- Background arc -->
            <path
              d="M 15,60 A 45,45 0 0,1 105,60"
              stroke="var(--color-border)"
              stroke-width="8"
              fill="none"
              stroke-linecap="butt"
            />
            <!-- Arc fill (current level) -->
            <path
              :d="getArcPath(currentLevelDb)"
              :stroke="currentLevelDb > -6 ? '#FF3B30' : 'var(--color-accent)'"
              stroke-width="8"
              fill="none"
              stroke-linecap="butt"
            />
            <!-- Clipping indicator if level exceeds -6dB -->
            <circle
              v-if="currentLevelDb > -6"
              cx="105"
              cy="60"
              r="4"
              fill="#FF3B30"
              opacity="0.8"
            />
            <!-- Tick marks -->
            <text x="12" y="68" font-size="9" font-weight="500" fill="var(--color-text-secondary)">-60</text>
            <text x="100" y="68" font-size="9" font-weight="500" fill="var(--color-text-secondary)">0</text>
          </svg>
          <div class="level-value">{{ currentLevelDb.toFixed(1) }}dB</div>
        </div>
      </div>

      <!-- Duration Display -->
      <div class="duration">
        <div class="duration-time">{{ formatTime(recordedDuration) }}</div>
        <div class="duration-max">/ {{ formatTime(maxDuration) }}</div>
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
import { ref, onMounted, onUnmounted } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';
import type { RecorderConfig } from '../types/audio';

const store = useAnalysisStore();
const isRecording = ref(false);
const currentLevel = ref(0);
const currentLevelDb = ref(-60);
const recordedDuration = ref(0);
const maxDuration = ref(20000);
const autoTriggerEnabled = ref(false);
const thresholdDb = ref(-40);
let animationId: number | null = null;

const emit = defineEmits<{
  'recorded': [{ samples: number }];
}>();

onMounted(() => {
  logger.debug('RecordingPanel', 'Mounted');
});

onUnmounted(() => {
  if (isRecording.value) {
    stopRecording();
  }
});

function getArcPath(level: number): string {
  // Clamp level to -60 to 0 dB range
  const clamped = Math.max(-60, Math.min(0, level));
  // Normalize to 0-1 (0 = -60dB, 1 = 0dB)
  const normalized = (clamped + 60) / 60;
  // Arc spans 180 degrees from -90 to 90 degrees
  const angle = Math.PI * normalized;
  // Center at (60, 60), radius 45
  const x = 60 + 45 * Math.cos(angle - Math.PI / 2);
  const y = 60 + 45 * Math.sin(angle - Math.PI / 2);
  const largeArc = normalized > 0.5 ? 1 : 0;
  return `M 15,60 A 45,45 0 ${largeArc},1 ${x},${y}`;
}

function formatTime(ms: number): string {
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

async function toggleRecording(): Promise<void> {
  if (!isRecording.value) {
    await startRecording();
  } else {
    await stopRecording();
  }
}

async function startRecording(): Promise<void> {
  try {
    const config: RecorderConfig = {
      sampleRate: 44100,
      maxDuration: maxDuration.value,
      channelCount: 1,
      autoThreshold: thresholdDb.value,
    };

    await store.recordAudio(config);
    isRecording.value = true;
    recordedDuration.value = 0;

    // Update level meter and duration
    animationId = setInterval(updateMeters, 50);

    logger.info('RecordingPanel', 'Recording started');
  } catch (error) {
    logger.error('RecordingPanel', 'Failed to start recording', { error: String(error) });
    isRecording.value = false;
  }
}

async function stopRecording(): Promise<void> {
  if (animationId !== null) {
    clearInterval(animationId);
    animationId = null;
  }

  try {
    await store.stopRecording();
    isRecording.value = false;

    const samples = store.audioBuffers.A.length;
    emit('recorded', { samples });

    logger.info('RecordingPanel', 'Recording stopped', { samples });
  } catch (error) {
    logger.error('RecordingPanel', 'Failed to stop recording', { error: String(error) });
  }
}

function updateMeters(): void {
  try {
    const state = store.recorder.getState();
    currentLevelDb.value = 20 * Math.log10(Math.max(state.level, 1e-10));
    recordedDuration.value = state.recordedDuration;
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

defineExpose({
  startRecording,
  stopRecording,
});
</script>

<style scoped>
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

.section-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.btn-record {
  background-color: #FF3B30;
  color: white;
  border: none;
  padding: 10px;
  border-radius: var(--radius-lg);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.btn-record:hover {
  filter: brightness(1.1);
}

.btn-record:active {
  filter: brightness(0.95);
}

.btn-record.recording {
  animation: pulse-record 1s infinite;
}

@keyframes pulse-record {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

.btn-stop {
  background-color: #FF3B30;
  color: white;
  border: none;
  padding: 10px;
  border-radius: var(--radius-lg);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
}

.btn-stop:hover {
  filter: brightness(1.1);
}

.btn-stop:active {
  filter: brightness(0.95);
}

.level-meter {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.level-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

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
  aspect-ratio: 120 / 70;
}

.level-value {
  font-family: var(--font-mono);
  font-size: 12px;
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
  font-size: 16px;
  font-weight: 600;
  color: var(--color-accent);
}

.duration-max {
  font-size: 11px;
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
}

.auto-trigger-header input {
  margin-right: 6px;
  cursor: pointer;
}

.auto-trigger-header label {
  font-size: 12px;
  color: var(--color-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
}

.auto-trigger-controls {
  padding: 8px;
  background-color: rgba(37, 99, 235, 0.05);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
}

.slider-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slider-group input[type="range"] {
  width: 100%;
}

.slider-value {
  font-size: 11px;
  color: var(--color-accent);
  font-weight: 500;
  font-family: var(--font-mono);
  text-align: right;
}

.input-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.value-label {
  font-size: 10px;
  color: var(--color-text-secondary);
  font-family: var(--font-body);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
