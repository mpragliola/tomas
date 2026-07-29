# Loop playback design

## Problem

`PlaybackPanel.vue` has a Play/Pause button that always plays from the current
position to the end of the active slot's buffer. Users who drag a selection on
the waveform (for spectral analysis) have no way to audition just that
selection repeatedly — they can only scrub back to the selection start by hand
after every pass.

## Goal

Add a Loop toggle next to Play. When active, playback loops within the
selection of whichever slot is currently sounding. If that slot has no
selection, loop the whole file instead.

## Scope

- `usePlayback.ts`: loop state, restart-on-toggle, restart-on-mode-switch
  (already-existing watcher), bounds resolution, progress-loop wraparound.
- `analysisStore.ts`: `playback()` accepts loop bounds and sets them natively
  on the `AudioBufferSourceNode`.
- `PlaybackPanel.vue`: Loop icon toggle button next to Play.

Out of scope: looping across A/B/C simultaneously, loop bounds independent of
the drag-selection, a dedicated loop-region UI distinct from the existing
analysis selection.

## Design

### Selection source

Loop bounds always come from `store.selections[activeSlot]` — the same slot
whose audio is currently sounding (A for Original/Processed, B for
Reference). This matches how the waveform/selection UI is already scoped per
slot, so switching A/B/C while looping naturally follows that slot's own
selection.

### Bounds resolution

A helper converts the active slot's `{startSample, endSample}` to seconds
using that slot's sample rate:

- If `endSample > startSample` (a real selection exists), bounds are
  `[startSample/sampleRate, endSample/sampleRate]`.
- Otherwise bounds are `[0, totalTime]` — the whole file.

Bounds are read fresh every time playback (re)starts, so a selection dragged
while paused, or while looping is armed but not yet playing, is picked up
automatically on the next Play press with no separate sync logic.

**Live edits during an active loop:** native `loopStart`/`loopEnd` are fixed
on the `AudioBufferSourceNode` at creation time — WebAudio exposes no
per-lap callback to update them without tearing down and rebuilding the
node, which would reintroduce the click/gap the native approach exists to
avoid. So a selection dragged while a loop is actively sounding updates
`store.selections` (visible on the waveform immediately) but the audio keeps
looping on the old bounds until the transport next restarts — Play toggled
off/on, Loop toggled off/on, or an A/B/C mode switch. This is an accepted
tradeoff in exchange for gapless looping.

### Playback engine (`analysisStore.playback`)

WebAudio's native loop support is used instead of manual restart-on-timer,
because it is sample-accurate and gapless — no JS timer can match that.

`playback()` gains two optional parameters: `loop: boolean` and
`loopEndSeconds?: number`. When `loop` is true:

```js
bufferSource.loop = true;
bufferSource.loopStart = startOffset;   // existing offset param doubles as loop start
bufferSource.loopEnd = loopEndSeconds;
```

`bufferSource.start(0, startOffset)` is unchanged — WebAudio plays from
`startOffset` once, then any subsequent cycles come from `loopStart`. A
looping source never fires `onended` until explicitly stopped, so the
existing `onended` cleanup path (which sets `playbackState` back to `idle`)
naturally only applies to non-looping playback — already true today since
looping sources are only ever stopped explicitly.

### Transport state (`usePlayback.ts`)

- New `isLooping = ref(false)`.
- New `toggleLoop()`: flips `isLooping`. If `isPlaying` is true, restarts
  playback at the current position (same `stopPlayback()` +
  `startPlayback()` pattern the `activeMode` watcher already uses), so the
  new loop bounds take effect immediately. If not playing, the flag is just
  armed for the next Play press.
- `startPlayback()` computes loop bounds (see above) when `isLooping.value`
  is true and passes them through to `store.playback()`.
- The existing `requestAnimationFrame` progress loop currently stops playback
  once `currentTime >= totalTime`. When looping, it instead wraps: once
  `currentTime` passes `loopEnd`, it resets to `loopStart` (offset by the
  overshoot, so the displayed readout stays sample-accurate to what the audio
  engine is actually doing) and keeps running instead of calling
  `stopPlayback()`.
- The `activeMode` watcher (switch between A/B/C) is unchanged in shape — it
  already stops and restarts playback on mode switch, so it picks up the new
  slot's loop bounds through the same `startPlayback()` call.

### UI (`PlaybackPanel.vue`)

- `.btn-play` and a new `.btn-loop` are wrapped in a `.transport-row` flex
  container, sitting side by side.
- `.btn-loop` is a small square icon-only button using the feather `repeat`
  icon, matching the sizing/border convention of `.tool-btn` in
  `WaveformEditor.vue` rather than the full-width `.btn-play` style.
- Always enabled (loops the whole file when there's no selection).
- `active` class applied when `isLooping` is true, styled with the same
  accent-highlight treatment as `.ab-btn.active`.
- `title` reflects state: `"Loop selection"` when off, `"Looping — click to
  stop"` when on.

## Testing

- Manual: load a file, drag a selection, enable Loop, press Play — audio
  should cycle the selection with no audible gap or click at the wrap point,
  and the time readout should track the loop correctly.
- Manual: enable Loop with no selection — whole file loops.
- Manual: toggle Loop on/off while already playing — playback restarts
  immediately reflecting the new state.
- Manual: drag the selection narrower/wider while looping is active —
  waveform selection updates immediately, but the looping audio keeps the
  old bounds until the transport is next restarted (see "Live edits during
  an active loop" above).
