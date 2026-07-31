<template>
  <div class="playback-panel">
    <div class="section-header">
      <label class="section-title">Playback</label>
    </div>

    <div v-if="!hasAudio" class="empty-state">
      <p>Load a sound to enable playback</p>
    </div>

    <div v-else class="playback-content">
      <!-- Source switch: A/B share a playhead, C runs on its own -->
      <div class="ab-switch">
        <button
          type="button"
          :class="['ab-btn', { active: activeMode === 'original' }]"
          title="Play the working sound untouched"
          @click="selectMode('original')"
        >A</button>
        <button
          type="button"
          :class="['ab-btn', { active: activeMode === 'processed' }]"
          :disabled="!hasIR"
          :title="hasIR ? 'Play the working sound through the derived IR' : 'Load a reference to derive an IR'"
          @click="selectMode('processed')"
        >A + IR</button>
        <button
          type="button"
          :class="['ab-btn', { active: activeMode === 'reference' }]"
          :disabled="!hasReference"
          :title="hasReference ? `Play «${activeReferenceLabel ?? 'the reference'}»` : 'No reference loaded'"
          @click="selectMode('reference')"
        >B</button>
      </div>

      <!-- Transport -->
      <div class="transport-row">
        <button
          :class="['btn-play', { playing: isPlaying }]"
          @click="togglePlayback"
        >
          <Icon v-if="!isPlaying" name="play" size="18" />
          <Icon v-else name="pause" size="18" />
          <span>{{ isPlaying ? 'Pause' : 'Play' }}</span>
        </button>
        <button
          type="button"
          :class="['btn-loop', { active: isLooping }]"
          :title="isLooping ? 'Looping — click to stop' : 'Loop selection'"
          @click="toggleLoop"
        >
          <Icon name="repeat" size="16" />
        </button>
      </div>

      <!-- Volume Control -->
      <div class="control-row">
        <label class="value-label">Volume</label>
        <input
          type="range"
          min="0"
          max="1"
          :step="VOLUME_STEP"
          v-model.number="volume"
          class="slider"
          @input="updateVolume"
          @wheel.prevent="nudgeVolume"
        />
        <span class="value">{{ (volume * 100).toFixed(0) }}%</span>
      </div>

      <!-- Live FFT Size -->
      <div class="control-row">
        <div class="label-with-tooltip">
          <label class="value-label">Live FFT</label>
          <TooltipIcon text="FFT window size for the live spectrum display during playback. Larger = better frequency resolution, higher latency." />
        </div>
        <select v-model.number="store.liveFFTSize" class="input-select">
          <option value="512">512 (~12ms)</option>
          <option value="1024">1024 (~23ms)</option>
          <option value="2048">2048 (~46ms)</option>
          <option value="4096">4096 (~93ms)</option>
          <option value="8192">8192 (~186ms)</option>
          <option value="16384">16384 (~372ms)</option>
        </select>
      </div>

      <!-- Readout only — the waveform above is the scrub surface -->
      <div class="time-display">
        <span>
          <span class="current-time">{{ formatTimeSecs(currentTime) }}</span>
          <span class="separator">/</span>
          <span class="total-time">{{ formatTimeSecs(totalTime) }}</span>
        </span>
        <span class="seek-hint">click waveform {{ activeSlot === 'A' ? 'A' : (activeReferenceLabel ?? 'reference') }} to seek</span>
      </div>

      <!-- Status -->
      <Transition name="fade-rise">
        <div v-if="statusMessage" class="status">
          {{ statusMessage }}
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';
import Icon from './Icon.vue';
import TooltipIcon from './TooltipIcon.vue';
import { usePlayback } from '../composables/usePlayback';
import { formatTimeSecs } from '../utils/audioFormat';

const VOLUME_STEP = 0.05;

const store = useAnalysisStore();
const volume = ref(store.playbackVolume);

const {
  isPlaying,
  isLooping,
  statusMessage,
  activeMode,
  activeSlot,
  activeReferenceLabel,
  currentTime,
  totalTime,
  hasAudio,
  hasReference,
  hasIR,
  togglePlayback: _togglePlayback,
  selectMode,
  toggleLoop,
} = usePlayback();

function togglePlayback(): Promise<void> {
  return _togglePlayback(volume.value);
}

/**
 * Space toggles play/pause from anywhere on the page — except while the user is actually
 * typing/picking in a form control, where Space has its own job (typing a space, toggling
 * a checkbox, stepping a select) that this must not steal.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.code !== 'Space' || event.repeat) return;
  if (isTypingTarget(event.target)) return;
  if (!hasAudio.value) return;
  event.preventDefault();
  togglePlayback();
}

onMounted(() => window.addEventListener('keydown', handleGlobalKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleGlobalKeydown));

// The gain node stays in the graph for the whole take, so this lands on what is already
// sounding — no restart, and no waiting for the next Play for the fader to mean anything
function updateVolume(): void {
  store.setVolume(volume.value);
  logger.debug('PlaybackPanel', 'Volume changed', { volume: volume.value });
}

/**
 * Wheel over the slider moves it by one step, so wheel, drag and arrow keys all land on
 * the same values. The page must not scroll under the cursor while doing it, hence the
 * .prevent on the handler.
 */
function nudgeVolume(event: WheelEvent): void {
  const delta = event.deltaY !== 0 ? -event.deltaY : event.deltaX;
  if (delta === 0) return;
  const raw = volume.value + Math.sign(delta) * VOLUME_STEP;
  // Accumulating 0.05 in binary drifts (0.35000000000000003), which the slider then
  // refuses to snap to — round back onto the step grid every time.
  const next = Math.min(1, Math.max(0, Math.round(raw / VOLUME_STEP) * VOLUME_STEP));
  if (next === volume.value) return;
  volume.value = next;
  updateVolume();
}
</script>

<style lang="scss" scoped>
@use '../styles/variables' as *;
@use '../styles/mixins' as *;

$gap: 12px;

.playback-panel {
  display: flex;
  flex-direction: column;
  gap: $gap;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  @include caps-label;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 150px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
}

.playback-content {
  display: flex;
  flex-direction: column;
  gap: $gap;
}

.ab-switch {
  display: flex;
  gap: 4px;
}

.ab-btn {
  flex: 1;
  min-width: 0;
  padding: 6px 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-label);
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: all $transition-fast;

  &:hover:not(:disabled) { border-color: var(--color-accent); }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  &.active {
    background-color: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-accent-text);
  }
}

.transport-row {
  display: flex;
  gap: 8px;
}

.btn-play {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: var(--radius-lg);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
  font-size: var(--font-size-base);
  font-weight: 600;
  cursor: pointer;
  transition: all $transition-fast;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  &:hover { filter: brightness(1.1); }

  &.playing { background-color: var(--color-warning); }
}

.btn-loop {
  flex-shrink: 0;
  width: 40px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all $transition-fast;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover { border-color: var(--color-accent); }

  &.active {
    background-color: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-accent-text);
  }
}

.control-row {
  display: flex;
  align-items: center;
  gap: 6px;

  input[type="range"] { flex: 1; }
}

.value-label {
  @include caps-label(10px);
  min-width: 50px;
}

.label-with-tooltip {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 50px;
}

.value {
  font-family: var(--font-body);
  font-size: var(--font-size-label);
  color: var(--color-accent);
  min-width: 35px;
  text-align: right;
}

.time-display {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-size-label);
  font-family: var(--font-body);
  color: var(--color-text-secondary);
}

.current-time {
  color: var(--color-accent);
  font-weight: 600;
}

.separator { margin: 0 4px; }

.seek-hint {
  opacity: 0.7;
  white-space: nowrap;
}

.input-select {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-bg);
  color: var(--color-text-primary);
  font-size: var(--font-size-label);
  font-family: var(--font-body);
  cursor: pointer;
  transition: border-color $transition-fast;

  &:hover { border-color: var(--color-text-secondary); }
  &:focus {
    outline: none;
    border-color: var(--color-accent);
  }
}

.status {
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background-color: color-mix(in srgb, var(--color-accent) 10%, transparent);
  border: 1px solid var(--color-accent);
  color: var(--color-accent);
  font-size: var(--font-size-label);
  text-align: center;
  font-weight: 500;
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
</style>
