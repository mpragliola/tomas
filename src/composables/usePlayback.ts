import { ref, computed, watch, onUnmounted } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';
import type { PlaybackMode } from '../types/audio';

export function usePlayback() {
  const store = useAnalysisStore();

  const isPlaying = ref(false);
  const statusMessage = ref('');
  // A and B are the same recording heard two ways, so they share a playhead and stay
  // comparable across a switch. C is a different file entirely — its own timeline.
  const abTime = ref(0);
  const refTime = ref(0);
  const mode = ref<PlaybackMode>('processed');
  const isLooping = ref(false);

  let animationFrameId: number | null = null;
  let playbackStartedAt = 0;
  // Bumped by every start and every stop. A start that awaits the store and comes back to
  // find a newer start (or a stop) has already happened must not install its progress loop.
  let startToken = 0;

  const hasAudio = computed(() => store.audioBuffers.A.length > 0);
  const hasReference = computed(() => store.audioBuffers.B.length > 0);
  const hasIR = computed(() => !!store.ir);

  /**
   * What is actually playable right now. The user's pick is remembered even when its
   * source vanishes (reference cancelled, IR discarded), so it comes back on its own
   * once the source returns instead of silently resetting to dry.
   */
  const activeMode = computed<PlaybackMode>(() => {
    if (mode.value === 'processed' && !hasIR.value) return 'original';
    if (mode.value === 'reference' && !hasReference.value) return 'original';
    return mode.value;
  });

  const activeSlot = computed<'A' | 'B'>(() => (activeMode.value === 'reference' ? 'B' : 'A'));

  const currentTime = computed(() => (activeMode.value === 'reference' ? refTime.value : abTime.value));

  function setCurrentTime(seconds: number): void {
    if (activeMode.value === 'reference') refTime.value = seconds;
    else abTime.value = seconds;
  }

  const totalTime = computed(() => {
    const slot = activeSlot.value;
    const buffer = store.audioBuffers[slot];
    if (!buffer || buffer.length === 0) return 0;
    return buffer.length / (store.sampleRates[slot] || 44100);
  });

  /**
   * Loop bounds for the slot currently sounding. An empty selection (drag never made, or
   * cleared) means loop the whole file rather than refuse to loop at all.
   */
  function loopBounds(): { start: number; end: number } {
    const slot = activeSlot.value;
    const selection = store.selections[slot];
    const sampleRate = store.sampleRates[slot] || 44100;
    if (selection.endSample > selection.startSample) {
      return {
        start: selection.startSample / sampleRate,
        end: selection.endSample / sampleRate,
      };
    }
    return { start: 0, end: totalTime.value };
  }

  // One place handles every source change — a user click, an IR that got discarded when a
  // waveform was cancelled, a reference that disappeared. Playback follows without a gap.
  watch(activeMode, async (next, previous) => {
    if (next === previous) return;
    if (!isPlaying.value) return;
    stopPlayback();
    if (totalTime.value === 0) return;
    await startPlayback(Math.min(currentTime.value, totalTime.value), store.playbackVolume);
  });

  // Both waveform cursors are published, not just the active one: A and B are heard on slot
  // A's timeline, C on slot B's, and the idle one holds the cue the user will come back to.
  watch([abTime, refTime], ([ab, reference]) => {
    store.playheads.A = ab;
    store.playheads.B = reference;
  }, { immediate: true });

  // The waveforms are the scrub surface, so a click there arrives as a store position the
  // transport did not write. Equality is what tells the two apart — a position this panel
  // just published is already in sync and must not restart anything.
  watch(() => store.playheads.A, (time) => applyExternalSeek('A', time));
  watch(() => store.playheads.B, (time) => applyExternalSeek('B', time));

  async function applyExternalSeek(slot: 'A' | 'B', time: number | null): Promise<void> {
    if (time === null) return;
    const local = slot === 'B' ? refTime.value : abTime.value;
    if (Math.abs(time - local) < 0.001) return;

    // Nothing is sounding on that timeline — just move its cue
    if (slot !== activeSlot.value) {
      if (slot === 'B') refTime.value = time;
      else abTime.value = time;
      return;
    }

    if (isPlaying.value) {
      stopPlayback();
      await startPlayback(time, store.playbackVolume);
    } else {
      setCurrentTime(time);
    }

    logger.debug('usePlayback', 'Seeked from waveform', { slot, time });
  }

  watch(hasAudio, (present) => {
    if (present) return;
    if (isPlaying.value) stopPlayback();
    abTime.value = 0;
  });

  watch(hasReference, (present) => {
    if (!present) refTime.value = 0;
  });

  onUnmounted(() => {
    // Unconditional: the store outlives this component, so a source it still holds would
    // keep sounding with no transport left on screen to stop it
    stopPlayback();
    if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
    // Same reason: the markers are store state, and nothing is driving them any more
    store.playheads.A = null;
    store.playheads.B = null;
  });

  async function startPlayback(offset: number, volume: number): Promise<void> {
    if (store.audioBuffers[activeSlot.value].length === 0) {
      statusMessage.value = 'No audio to play';
      return;
    }

    const token = ++startToken;

    try {
      isPlaying.value = true;
      setCurrentTime(offset);

      const bounds = isLooping.value ? loopBounds() : null;
      await store.playback(volume, activeMode.value, offset, isLooping.value, bounds?.start, bounds?.end);

      // Something else took over while the store was starting up — it owns the transport now
      if (token !== startToken) return;

      playbackStartedAt = Date.now() - offset * 1000;

      const updateProgress = () => {
        if (!isPlaying.value || token !== startToken) return;

        const elapsed = (Date.now() - playbackStartedAt) / 1000;
        const rawTime = Math.min(elapsed, totalTime.value);

        if (bounds && rawTime >= bounds.end) {
          // The audio engine has already wrapped to loopStart on its own clock (native
          // loop, gapless); this only re-bases the JS-side clock the same way, carrying
          // the overshoot forward so the displayed time stays sample-accurate instead of
          // snapping to exactly bounds.start every lap.
          const lapLength = bounds.end - bounds.start;
          const overshoot = lapLength > 0 ? (rawTime - bounds.end) % lapLength : 0;
          playbackStartedAt = Date.now() - (bounds.start + overshoot) * 1000;
          setCurrentTime(bounds.start + overshoot);
          animationFrameId = requestAnimationFrame(updateProgress);
          return;
        }

        setCurrentTime(rawTime);

        if (rawTime >= totalTime.value) {
          stopPlayback();
          setCurrentTime(0);
        } else {
          animationFrameId = requestAnimationFrame(updateProgress);
        }
      };

      animationFrameId = requestAnimationFrame(updateProgress);
      logger.info('usePlayback', 'Playback started', { volume, mode: activeMode.value, offset });
    } catch (error) {
      logger.error('usePlayback', 'Playback failed', { error: String(error) });
      if (token !== startToken) return;
      statusMessage.value = 'Playback error';
      isPlaying.value = false;
    }
  }

  function stopPlayback(): void {
    startToken++;
    isPlaying.value = false;
    store.stopPlayback();

    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    statusMessage.value = '';
    logger.info('usePlayback', 'Playback stopped');
  }

  async function togglePlayback(volume: number): Promise<void> {
    if (isPlaying.value) {
      stopPlayback();
    } else {
      await startPlayback(currentTime.value, volume);
    }
  }

  // Just record the pick — the activeMode watcher does the stop/restart, so a switch the
  // user makes and one forced by a cancelled waveform behave identically.
  function selectMode(target: PlaybackMode): void {
    if (target === 'processed' && !hasIR.value) return;
    if (target === 'reference' && !hasReference.value) return;
    mode.value = target;
  }

  // Flips the flag; if something is already sounding, restart it so the new loop bounds
  // (or the drop back to normal single-shot playback) take effect immediately instead of
  // waiting for the next Play press.
  async function toggleLoop(): Promise<void> {
    isLooping.value = !isLooping.value;
    if (!isPlaying.value) return;
    const resumeAt = currentTime.value;
    stopPlayback();
    await startPlayback(resumeAt, store.playbackVolume);
  }

  return {
    isPlaying,
    isLooping,
    statusMessage,
    abTime,
    refTime,
    activeMode,
    activeSlot,
    currentTime,
    totalTime,
    hasAudio,
    hasReference,
    hasIR,
    startPlayback,
    stopPlayback,
    togglePlayback,
    selectMode,
    toggleLoop,
  };
}
