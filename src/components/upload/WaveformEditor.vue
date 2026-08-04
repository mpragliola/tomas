<template>
  <!-- Stays mounted (v-show) so the waver ref is always valid -->
  <div v-show="active" class="loaded-state" @pointerdown="dragging = true">
    <div class="waveform-host-wrap">
      <Waver
        ref="waverRef"
        :height="96"
        :theme="theme"
        :view-mode="view"
        show-zero-line
        show-minimap
        :load-button="loadButtonState"
        :record-button="recordButtonState"
        :monitor-button="monitorButtonState"
        :input-stream="inputStream"
        :channel-index="store.selectedChannelIndex"
        :validate-file="validateFile"
        class="waveform-host"
        @selectionchange="onSelectionChange"
        @cursorchange="onCursorChange"
        @zoomchange="onZoomChange"
        @recordstart="onRecordStart"
        @recordstop="onRecordStop"
        @recorderror="onRecordError"
        @monitorstart="onMonitorStart"
        @monitorstop="onMonitorStop"
        @loadsuccess="onLoadSuccess"
        @loaderror="onLoadError"
      />
    </div>

    <div class="waveform-footer">
      <span class="duration">{{ durationLabel }}</span>
      <span class="selection-info">{{ selectionLabel }}</span>
    </div>

    <div class="waveform-tools">
      <input
        type="range"
        class="zoom-slider"
        :min="ZOOM_MIN"
        :max="ZOOM_MAX"
        step="0.5"
        :value="zoom"
        @input="setZoom(Number(($event.target as HTMLInputElement).value))"
        title="Zoom"
      />
      <button
        type="button"
        class="tool-btn"
        :title="view === 'waveform' ? 'Show spectrogram' : 'Show waveform'"
        @click.stop="view = view === 'waveform' ? 'spectrogram' : 'waveform'"
      >
        <Icon :name="view === 'waveform' ? 'bar-chart-2' : 'activity'" size="14" />
      </button>
      <button
        type="button"
        class="tool-btn"
        title="Reset zoom & selection"
        @click.stop="resetView"
      >
        <Icon name="rotate-ccw" size="14" />
      </button>
      <button type="button" class="cancel-btn" title="Remove file" aria-label="Remove file" @click.stop="clearAndReset">
        <Icon name="x" size="16" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue';
import { Waver } from 'waver/vue';
import type { ViewMode } from 'waver';
import Icon from '../Icon.vue';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useSpectrumScheduler } from '../../composables/useSpectrumScheduler';
import { openInputStream } from '../../services/audio/devices';
import { SUPPORTED_AUDIO_EXTENSIONS, isSupportedAudioFile } from '../../services/audio/audioLoader';
import {
  useWaveformSlot,
  ZOOM_MIN,
  ZOOM_MAX,
  type WaveformTarget,
  type WaverHandle,
} from '../../composables/useWaveformSlot';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

const props = defineProps<{
  target: WaveformTarget;
  /** The block is laid out and can be measured. */
  active: boolean;
}>();

const emit = defineEmits<{
  /** For A: clear the loaded file. For a reference tab: remove that tab. Meaning is
   * resolved by the caller (AudioSlot.vue / ReferenceSlot.vue), not baked in here. */
  clear: [];
  status: [message: string, durationMs: number];
}>();

const store = useAnalysisStore();
const waverRef = ref<WaverHandle>();
/** Which of waver's two stacked views is on top. */
const view = ref<ViewMode>('waveform');

// A mid-drag selection is transiently too short every time it starts — surfacing that as
// a warning would flash one on screen for the whole drag. Only report refusals once the
// user has actually settled on a selection.
const dragging = ref(false);
function stopDragging(): void {
  dragging.value = false;
}
onMounted(() => window.addEventListener('pointerup', stopDragging));
onUnmounted(() => window.removeEventListener('pointerup', stopDragging));

// Passed as getters, not `props.target` itself: this component instance is reused across
// reference tab switches (only the `target` prop's value changes), and a composable's
// setup runs once — a raw value would freeze on whichever tab was active at first mount.
const spectrum = useSpectrumScheduler(() => props.target, {
  // A selection the FFT refuses is otherwise indistinguishable from a selection
  // that worked — the region is drawn either way and nothing downstream moves.
  // Suppressed mid-drag: see `dragging` above.
  onError: (message) => {
    if (!dragging.value) emit('status', message, 3000);
  },
  // Empty clears — a refusal must not outlive the selection that fixed it
  onSuccess: () => emit('status', '', 0),
});

const { theme, zoom, setZoom, resetView, onSelectionChange, onCursorChange, onZoomChange } = useWaveformSlot(
  () => props.target,
  waverRef,
  {
    active: computed(() => props.active),
    onStatus: (message, durationMs) => emit('status', message, durationMs),
    onSelectionChange: spectrum.schedule,
  },
);

/** Does `store.recordingTarget` (or a target snapshot) refer to the same slot as `target`? */
function sameTarget(a: WaveformTarget, b: WaveformTarget | null): boolean {
  if (b === null) return false;
  return a === 'A' ? b === 'A' : b !== 'A' && b.referenceId === a.referenceId;
}

const recordButtonState = computed<'enabled' | 'disabled'>(() => {
  const lockedTo = store.recordingTarget;
  if (lockedTo === null) return 'enabled';
  return sameTarget(props.target, lockedTo) ? 'enabled' : 'disabled';
});

// Same lock as Record/Monitor — loading a file mid-recording elsewhere would otherwise
// look available while nothing sane could happen if clicked.
const loadButtonState = computed<'enabled' | 'disabled'>(() => {
  const lockedTo = store.recordingTarget;
  if (lockedTo === null) return 'enabled';
  return sameTarget(props.target, lockedTo) ? 'enabled' : 'disabled';
});

// Monitoring shares the record lock — both use whatever mic/device is currently
// selected, so a slot monitoring the input and another slot recording it at the same
// time would just be two consumers fighting over one stream. Reusing recordingTarget
// keeps that one-at-a-time rule in a single place rather than a parallel lock field.
const monitorButtonState = computed<'enabled' | 'disabled'>(() => {
  const lockedTo = store.recordingTarget;
  if (lockedTo === null) return 'enabled';
  return sameTarget(props.target, lockedTo) ? 'enabled' : 'disabled';
});

/**
 * This instance is reused across reference-tab switches (ReferenceSlot.vue swaps only the
 * `target` prop, never remounting) and can also unmount outright (last tab removed, or
 * navigating away). waver's `disconnectedCallback()` calls `recorderEngine?.cancel()` on
 * teardown, which tears the recorder down silently — no `recordstop`/`recorderror` fires.
 * Since `onRecordStop`/`onRecordError` above are the only places that ever clear
 * `store.recordingTarget`, a mid-recording tab switch or unmount would otherwise leave the
 * lock stuck forever (every slot's Record button permanently disabled, no recovery short of
 * a reload).
 *
 * Only touches the lock when it's still this instance's own target (never someone else's
 * recording) and this instance actually still has a live recording or monitoring session in
 * progress (waver's own `isRecording()`/`isMonitoring()`, not just "was this target once locked").
 */
function isOrphanedHere(target: WaveformTarget): boolean {
  if (!sameTarget(target, store.recordingTarget)) return false;
  return waverRef.value?.isRecording() === true || waverRef.value?.isMonitoring() === true;
}

/**
 * Unmount: `onBeforeUnmount`, not `onUnmounted` — at this point the component and its
 * `<wave-r>` element are still fully live, so `waverRef.value` is guaranteed non-null and
 * `isRecording()` reads the pre-teardown state directly. Whether Vue nulls the template ref
 * (or the browser has already run `disconnectedCallback()`) by the time `onUnmounted` fires
 * isn't a contract either side promises, so this is the reliable point to check. No need to
 * stop anything here — `disconnectedCallback()` calling `recorderEngine?.cancel()` right
 * after this component tears down handles that; only the app-level lock needs releasing.
 */
onBeforeUnmount(() => {
  if (isOrphanedHere(props.target)) store.recordingTarget = null;
});

/**
 * Tab switch: the same `<Waver>` DOM element stays mounted (only `props.target`'s value
 * changes), so `disconnectedCallback()` never fires and the recorder keeps running in the
 * background against a target that's no longer displayed — `isRecording()` and the element's
 * own recording UI would still read "recording" under the *new* tab. Left alone, a user could
 * then hit what looks like that tab's Stop button and have the orphaned take saved into the
 * wrong slot (`onRecordStop` reads the *current* `props.target`). `reset()` stops and discards
 * the take instead of saving it — correct here, since switching tabs (not clicking Stop) is
 * what ended it. Safe to clear the element's samples too: `useWaveformSlot`'s own watch on the
 * same target change reloads the new target's audio via `loadSamples()` right after this runs
 * — that watch is `flush: 'post'` (runs after DOM update) while this one uses the default
 * `flush: 'pre'` (runs before), so this always resolves first and nothing is left showing the
 * discarded recording.
 */
watch(
  () => props.target,
  (_newTarget, oldTarget) => {
    if (oldTarget === undefined || !isOrphanedHere(oldTarget)) return;
    store.recordingTarget = null;
    waverRef.value?.reset();
  },
  { flush: 'pre' },
);

function onRecordStart(): void {
  store.recordingTarget = props.target;
}

async function onRecordStop(): Promise<void> {
  const el = waverRef.value;
  store.recordingTarget = null;
  if (!el) return;

  const samples = el.getSamples();
  const sampleRate = el.getSampleRate();
  if (samples.length === 0) return;

  if (props.target === 'A') {
    await store.finishRecordingIntoA(samples, sampleRate);
  } else {
    await store.finishRecordingIntoReference(props.target.referenceId, samples, sampleRate);
  }
}

function onRecordError(error: Error): void {
  store.recordingTarget = null;
  emit('status', `Recording failed: ${error.message}`, 3000);
}

/**
 * waver's own built-in Load button decoded the file internally — `getSamples()` there is
 * whatever channel 0 alone contains, not the L+R mixdown the rest of this app expects, so
 * `finishLoadIntoA`/`finishLoadIntoReference` re-derive the mono mix from `getChannels()`
 * themselves rather than trusting `getSamples()` for a multichannel source.
 */
async function onLoadSuccess(detail: { fileName: string }): Promise<void> {
  const el = waverRef.value;
  if (!el) return;

  const samples = el.getSamples();
  const channels = el.getChannels();
  const sampleRate = el.getSampleRate();
  if (samples.length === 0) return;

  if (props.target === 'A') {
    await store.finishLoadIntoA(detail.fileName, samples, channels, sampleRate);
  } else {
    await store.finishLoadIntoReference(props.target.referenceId, detail.fileName, samples, channels, sampleRate);
  }
}

/** Fires both for a `validateFile` rejection (a complete, user-facing message already,
 * e.g. "File is empty") and a real decode failure (a generic browser error) — same
 * one-line surface `useAudioFileLoader`'s `onError` used for both cases before. */
function onLoadError(error: Error): void {
  emit('status', error.message, 3000);
}

/** Runs before waver decodes a file picked via its own Load button or its own drag-drop
 * (the app no longer has a file input or drop zone of its own for either) — same checks
 * `useAudioFileLoader`/`useReferenceFileLoader` used to run in front of their own inputs. */
function validateFile(file: File): string | null {
  if (!isSupportedAudioFile(file.name)) {
    const ext = file.name.split('.').pop() || 'unknown';
    return `Invalid file type. Expected one of ${SUPPORTED_AUDIO_EXTENSIONS.join(', ')}, got ${ext}`;
  }
  if (file.size === 0) return 'File is empty';
  if (file.size > MAX_FILE_SIZE) {
    return `File too large. Max 100MB, got ${(file.size / 1024 / 1024).toFixed(1)}MB`;
  }
  return null;
}

function clearAndReset(): void {
  waverRef.value?.reset();
  emit('clear');
}

function onMonitorStart(): void {
  store.recordingTarget = props.target;
}

function onMonitorStop(): void {
  store.recordingTarget = null;
}

/**
 * Opens a MediaStream for the store's currently-selected input device and hands it to
 * this instance's <Waver> via the `inputStream` prop, so its Record button (and any
 * explicit `startRecording()` call) uses the picked device instead of the default mic.
 * Re-opened whenever the picker selection changes — not lazily on Record press — since
 * `inputStream` must already be set before the user presses Record for that press to use
 * it. Empty `selectedInputDeviceId` ("System default") intentionally leaves `inputStream`
 * null so waver falls back to its own getUserMedia() default-device request.
 */
const inputStream = ref<MediaStream | null>(null);

/**
 * Guards against two races around the `await openInputStream(...)` below, both of which
 * would otherwise leak a live MediaStream (mic stays "on" in the browser's own recording
 * indicator with nothing left referencing it to ever stop it):
 *  1. Two device switches in quick succession — the first call's `getUserMedia()` can
 *     still resolve after the second call has already started (or already finished and
 *     assigned `inputStream.value`), and would otherwise stomp the newer stream in place
 *     without ever stopping its own now-abandoned one.
 *  2. Unmount while a call is still in flight — the existing `onUnmounted` below only
 *     stops whatever `inputStream.value` already holds at that moment; it can't stop a
 *     stream that resolves *after* unmount, because nothing assigns it there yet.
 * Each call captures the generation counter's value at its own start; if the counter has
 * moved on by the time its `getUserMedia()` resolves, this call is stale — its stream (if
 * it got one) is stopped immediately instead of stored, and `inputStream.value` is left
 * untouched (whatever the newer call already put there, or unmount already cleared).
 */
let inputStreamGeneration = 0;

async function refreshInputStream(): Promise<void> {
  const generation = ++inputStreamGeneration;

  inputStream.value?.getTracks().forEach((t) => t.stop());
  inputStream.value = null;
  if (!store.selectedInputDeviceId) return; // "system default" — let waver fall back to getUserMedia itself

  let stream: MediaStream | null = null;
  try {
    stream = await openInputStream(store.selectedInputDeviceId);
  } catch {
    stream = null;
  }

  if (generation !== inputStreamGeneration) {
    // A newer call (or unmount, which also bumps the generation) started while this one
    // was awaiting getUserMedia() — this stream is stale, discard without storing it.
    stream?.getTracks().forEach((t) => t.stop());
    return;
  }
  inputStream.value = stream;
}

watch(() => store.selectedInputDeviceId, refreshInputStream, { immediate: true });

onUnmounted(() => {
  inputStreamGeneration++; // invalidate any in-flight refreshInputStream() call
  inputStream.value?.getTracks().forEach((t) => t.stop());
});

/** Same seam useWaveformSlot uses internally — resolve buffer/rate/selection for
 * whichever target this instance is showing. */
function resolveTarget() {
  if (props.target === 'A') {
    return {
      buffer: store.audioBufferA,
      sampleRate: store.sampleRateA,
      selection: store.selectionA,
    };
  }
  const reference = store.references[props.target.referenceId];
  const asset = reference?.assetId ? store.audioAssets[reference.assetId] : undefined;
  return {
    buffer: asset?.buffer ?? new Float32Array(),
    sampleRate: asset?.sampleRate ?? 44100,
    selection: reference?.selection ?? null,
  };
}

const durationLabel = computed(() => {
  const { buffer, sampleRate } = resolveTarget();
  if (buffer.length === 0) return '0.00s';
  return `${(buffer.length / sampleRate).toFixed(2)}s`;
});

const selectionLabel = computed(() => {
  const { selection, sampleRate } = resolveTarget();
  if (!selection || selection.endSample <= selection.startSample) return 'drag to select';
  const start = (selection.startSample / sampleRate).toFixed(2);
  const end = (selection.endSample / sampleRate).toFixed(2);
  return `${start}s – ${end}s`;
});
</script>

<style lang="scss" scoped>
@use '../../styles/variables' as *;

$icon-btn-size: 28px;

@mixin icon-btn {
  background-color: var(--color-bg);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all $transition-fast;
  display: flex;
  align-items: center;
  justify-content: center;
  width: $icon-btn-size;
  height: $icon-btn-size;
  flex-shrink: 0;
}

.loaded-state {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.waveform-host {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.waveform-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border);
}

.duration {
  font-family: var(--font-body);
  font-size: var(--font-size-label);
  color: var(--color-text-secondary);
}

.selection-info {
  font-family: var(--font-body);
  font-size: var(--font-size-label);
  color: var(--color-accent);
  white-space: nowrap;
}

.waveform-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}

.zoom-slider {
  flex: 1;
  min-width: 0;
  height: 4px;
}

.tool-btn {
  @include icon-btn;

  &:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  &.active {
    border-color: var(--color-accent);
    color: var(--color-accent);
    background-color: color-mix(in srgb, var(--color-accent) 15%, transparent);
  }
}

.cancel-btn {
  @include icon-btn;
  padding: 4px 8px;
  font-size: var(--font-size-base);

  &:hover {
    border-color: var(--color-error);
    color: var(--color-error);
    background-color: color-mix(in srgb, var(--color-error) 5%, transparent);
  }
}
</style>
