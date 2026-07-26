<template>
  <div class="playback-panel">
    <div class="section-header">
      <label class="section-title">Playback</label>
    </div>

    <div v-if="!store.convolved || store.convolved.length === 0" class="empty-state">
      <p>Apply IR to enable playback</p>
    </div>

    <div v-else class="playback-content">
      <!-- Play Button -->
      <button
        :class="['btn-play', { playing: isPlaying }]"
        @click="togglePlayback"
      >
        <span v-if="!isPlaying">▶ Play</span>
        <span v-else>⏸ Pause</span>
      </button>

      <!-- Volume Control -->
      <div class="control-row">
        <label class="value-label">Volume</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          v-model.number="volume"
          class="slider"
          @change="updateVolume"
        />
        <span class="value">{{ (volume * 100).toFixed(0) }}%</span>
      </div>

      <!-- Progress Bar -->
      <div class="progress-section">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <div class="time-display">
          <span class="current-time">{{ formatTime(currentTime) }}</span>
          <span class="separator">/</span>
          <span class="total-time">{{ formatTime(totalTime) }}</span>
        </div>
      </div>

      <!-- Status -->
      <div v-if="statusMessage" class="status">
        {{ statusMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';

const store = useAnalysisStore();
const isPlaying = ref(false);
const volume = ref(0.8);
const currentTime = ref(0);
const statusMessage = ref('');
let animationFrameId: number | null = null;

const totalTime = computed(() => {
  if (!store.convolved || store.convolved.length === 0) return 0;
  const sampleRate = 44100;
  return store.convolved.length / sampleRate;
});

const progressPercent = computed(() => {
  if (totalTime.value === 0) return 0;
  return (currentTime.value / totalTime.value) * 100;
});

onUnmounted(() => {
  if (isPlaying.value) {
    stopPlayback();
  }
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
  }
});

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}:${Number(secs) < 10 ? '0' : ''}${secs}`;
}

async function togglePlayback(): Promise<void> {
  if (isPlaying.value) {
    stopPlayback();
  } else {
    await startPlayback();
  }
}

async function startPlayback(): Promise<void> {
  if (!store.convolved || store.convolved.length === 0) {
    statusMessage.value = 'No audio to play';
    return;
  }

  try {
    isPlaying.value = true;
    currentTime.value = 0;
    statusMessage.value = 'Playing...';

    await store.playback(volume.value);

    // Simulate playback progress
    const sampleRate = 44100;
    const startTime = Date.now();

    const updateProgress = () => {
      if (!isPlaying.value) return;

      const elapsed = (Date.now() - startTime) / 1000;
      currentTime.value = Math.min(elapsed, totalTime.value);

      if (currentTime.value >= totalTime.value) {
        stopPlayback();
      } else {
        animationFrameId = requestAnimationFrame(updateProgress);
      }
    };

    animationFrameId = requestAnimationFrame(updateProgress);
    logger.info('PlaybackPanel', 'Playback started', { volume: volume.value });
  } catch (error) {
    logger.error('PlaybackPanel', 'Playback failed', { error: String(error) });
    statusMessage.value = 'Playback error';
    isPlaying.value = false;
  }
}

function stopPlayback(): void {
  isPlaying.value = false;
  store.stopPlayback();

  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  statusMessage.value = '';
  logger.info('PlaybackPanel', 'Playback stopped');
}

function updateVolume(): void {
  logger.debug('PlaybackPanel', 'Volume changed', { volume: volume.value });
}
</script>

<style scoped>
.playback-panel {
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

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 150px;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.playback-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.btn-play {
  padding: 10px;
  border: none;
  border-radius: var(--radius-lg);
  background-color: var(--color-accent);
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-play:hover {
  filter: brightness(1.1);
}

.btn-play.playing {
  background-color: #FF9500;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.control-row input[type="range"] {
  flex: 1;
}

.value-label {
  font-size: 10px;
  font-weight: 500;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  min-width: 50px;
}

.value {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-accent);
  min-width: 35px;
  text-align: right;
}

.progress-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-bar {
  height: 4px;
  background-color: var(--color-border);
  border-radius: 2px;
  overflow: hidden;
  cursor: pointer;
}

.progress-fill {
  height: 100%;
  background-color: var(--color-accent);
  transition: width 50ms linear;
}

.time-display {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--color-text-secondary);
}

.current-time {
  color: var(--color-accent);
  font-weight: 600;
}

.separator {
  margin: 0 4px;
}

.status {
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background-color: rgba(37, 99, 235, 0.1);
  border: 1px solid var(--color-accent);
  color: var(--color-accent);
  font-size: 10px;
  text-align: center;
  font-weight: 500;
}
</style>
