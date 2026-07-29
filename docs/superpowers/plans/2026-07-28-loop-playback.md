# Loop Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Loop toggle button next to Play in `PlaybackPanel.vue` that, when active, loops playback within the active slot's drag-selection (or the whole file if there's no selection), using native `AudioBufferSourceNode` `loopStart`/`loopEnd` for gapless looping.

**Architecture:** `analysisStore.playback()` grows two optional parameters (`loop`, `loopEndSeconds`) that set native loop properties on the buffer source. `usePlayback.ts` grows an `isLooping` ref, a `toggleLoop()` action, a bounds-resolution helper reading `store.selections[activeSlot]`, and a modified `requestAnimationFrame` progress loop that wraps the displayed time instead of stopping at `loopEnd` when looping. `PlaybackPanel.vue` grows one new icon button wired to `toggleLoop`.

**Tech Stack:** Vue 3 (`<script setup>`, Composition API), TypeScript, WebAudio API (`AudioBufferSourceNode.loop`/`loopStart`/`loopEnd`), Vitest (existing suite covers `src/services` and `src/utils` only — no unit tests exist for composables or `.vue` files; `vitest.config.ts` runs in `environment: 'node'` with no DOM/WebAudio available, and excludes `.vue` from coverage).

## Global Constraints

- Loop bounds always come from `store.selections[activeSlot]` (the slot currently sounding — A for Original/Processed, B for Reference), never a separate loop-region UI.
- Empty selection (`endSample <= startSample`) means loop the whole file (`[0, totalTime]`).
- Looping must use native `loopStart`/`loopEnd` on `AudioBufferSourceNode` — not a JS-timer restart — to stay gapless.
- Bounds are fixed at the point the `AudioBufferSourceNode` is created; a selection dragged while a loop is actively sounding is picked up only on the next transport restart (Play toggled, Loop toggled, or A/B/C mode switch), not mid-lap. This is accepted, not a bug.
- No new automated tests are added for this feature (see Testing section) — verify manually through the dev server, consistent with the existing codebase's testing boundary (composables/`.vue` files are untested; only `src/services`/`src/utils` have Vitest coverage).

---

## File Structure

- Modify: `src/stores/analysisStore.ts` — `playback()` gains `loop`/`loopEndSeconds` params, sets them on the `AudioBufferSourceNode`.
- Modify: `src/composables/usePlayback.ts` — `isLooping` ref, `toggleLoop()`, bounds-resolution helper, progress-loop wraparound, `startPlayback()` passes loop args through.
- Modify: `src/components/PlaybackPanel.vue` — new `.btn-loop` icon toggle beside `.btn-play`, wrapped in a `.transport-row`.

No new files. No test files (see Global Constraints).

---

### Task 1: `analysisStore.playback()` accepts loop bounds

**Files:**
- Modify: `src/stores/analysisStore.ts:685-781` (the `playback` function)

**Interfaces:**
- Consumes: nothing new — same `audioBuffers`, `channelBuffers`, `sampleRates` the function already reads.
- Produces: `playback(volume: number, mode?: PlaybackMode, offset?: number, loop?: boolean, loopStartSeconds?: number, loopEndSeconds?: number): Promise<void>` — the three new trailing params are optional so every existing call site (there are calls in `usePlayback.ts` today) keeps compiling unchanged until Task 2 updates them. **Key design note:** `loopStart` is independent from `offset` — the first lap starts at `offset` (so a paused loop can resume mid-selection), but every subsequent lap wraps to `loopStart` (the true selection start). This decoupling ensures the loop always cycles the same bounds regardless of where playback began.

- [ ] **Step 1: Read the current signature and body to confirm line numbers**

Run: `grep -n "async function playback" src/stores/analysisStore.ts`

Expected: one match around line 685, `async function playback(volume: number, mode: PlaybackMode = 'processed', offset = 0): Promise<void> {`

- [ ] **Step 2: Update the signature and set native loop properties on the buffer source**

In `src/stores/analysisStore.ts`, change:

```ts
  async function playback(volume: number, mode: PlaybackMode = 'processed', offset = 0): Promise<void> {
```

to:

```ts
  async function playback(
    volume: number,
    mode: PlaybackMode = 'processed',
    offset = 0,
    loop = false,
    loopStartSeconds?: number,
    loopEndSeconds?: number,
  ): Promise<void> {
```

Then find this block later in the same function:

```ts
    const bufferSource = context.createBufferSource();
    bufferSource.buffer = buffer;
```

and change it to:

```ts
    const bufferSource = context.createBufferSource();
    bufferSource.buffer = buffer;

    // Native loop support is sample-accurate and gapless — no JS timer can match that.
    // The first lap starts at startOffset (allowing a paused loop to resume mid-range),
    // but every subsequent lap wraps to loopStart, ensuring the loop cycles the same
    // bounds regardless of where playback began.
    if (loop && loopStartSeconds !== undefined && loopEndSeconds !== undefined) {
      bufferSource.loop = true;
      bufferSource.loopStart = loopStartSeconds;
      bufferSource.loopEnd = loopEndSeconds;
    }
```

- [ ] **Step 3: Update the log call to include the new params (optional but keeps parity with existing logging style)**

Find:

```ts
    logger.info('analysisStore', 'Starting playback', { volume, mode, samples: source.length, offset });
```

Change to:

```ts
    logger.info('analysisStore', 'Starting playback', { volume, mode, samples: source.length, offset, loop, loopStartSeconds, loopEndSeconds });
```

- [ ] **Step 4: Build to confirm the change compiles**

Run: `npm run build`
Expected: build completes with no errors. (`npx vue-tsc --noEmit` is not usable in this environment — the installed `vue-tsc@3.3.8` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` against `typescript@7.0.2`, a pre-existing environment issue unrelated to this feature. `vite build` uses esbuild for transpilation, not `tsc`, so it still catches syntax errors and Vue template/script mismatches even though it won't catch every type error `vue-tsc` would.)

- [ ] **Step 5: Run the existing test suite to confirm nothing broke**

Run: `npm test -- --run`
Expected: same pass count as baseline (84 tests passed, 0 failures) — this task touches no code path any existing test exercises, so the count must not change.

- [ ] **Step 6: Commit**

```bash
git add src/stores/analysisStore.ts
git commit -m "feat: add loop bounds params to analysisStore.playback"
```

---

### Task 2: `usePlayback.ts` loop state and bounds resolution

**Files:**
- Modify: `src/composables/usePlayback.ts`

**Interfaces:**
- Consumes: `store.playback(volume, mode, offset, loop, loopStartSeconds, loopEndSeconds)` from Task 1; `store.selections[slot]: { startSample: number; endSample: number; duration: number }` (already exists, `src/stores/analysisStore.ts:42-45`); `activeSlot`, `totalTime`, `store.sampleRates[slot]` (already exist in this file).
- Produces: `isLooping: Ref<boolean>` and `toggleLoop(): Promise<void>`, both returned from `usePlayback()` for `PlaybackPanel.vue` (Task 3) to consume.

- [ ] **Step 1: Add the `isLooping` ref and a bounds-resolution helper**

In `src/composables/usePlayback.ts`, near the other refs (after line 15, `const mode = ref<PlaybackMode>('processed');`), add:

```ts
  const isLooping = ref(false);
```

After the `totalTime` computed (currently ending at line 52), add a new function:

```ts
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
```

- [ ] **Step 2: Build (no behavior yet, just confirming the new code compiles)**

Run: `npm run build`
Expected: build completes with no errors. (See Task 1 Step 4 for why `vue-tsc` is skipped in this environment.)

- [ ] **Step 3: Commit the scaffolding**

```bash
git add src/composables/usePlayback.ts
git commit -m "feat: add loop bounds resolution to usePlayback"
```

---

### Task 3: Wire loop bounds into `startPlayback` and the progress loop

**Files:**
- Modify: `src/composables/usePlayback.ts:119-160` (`startPlayback`)

**Interfaces:**
- Consumes: `isLooping` and `loopBounds()` from Task 2.
- Produces: `startPlayback` now starts a genuinely looping source when `isLooping.value` is true; the progress `requestAnimationFrame` loop wraps instead of stopping when looping.

- [ ] **Step 1: Pass loop args through to `store.playback`**

Find, in `startPlayback`:

```ts
      await store.playback(volume, activeMode.value, offset);
```

Replace with:

```ts
      const bounds = isLooping.value ? loopBounds() : null;
      await store.playback(volume, activeMode.value, offset, isLooping.value, bounds?.start, bounds?.end);
```

- [ ] **Step 2: Make the progress loop wrap instead of stop when looping**

Find the `updateProgress` closure inside `startPlayback`:

```ts
      const updateProgress = () => {
        if (!isPlaying.value || token !== startToken) return;

        const elapsed = (Date.now() - playbackStartedAt) / 1000;
        setCurrentTime(Math.min(elapsed, totalTime.value));

        if (currentTime.value >= totalTime.value) {
          stopPlayback();
          setCurrentTime(0);
        } else {
          animationFrameId = requestAnimationFrame(updateProgress);
        }
      };
```

Replace with:

```ts
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
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 4: Run the existing test suite**

Run: `npm test -- --run`
Expected: 84 tests passed, 0 failures (this composable has no existing tests; this step confirms Task 1's store change still doesn't break any pure-logic test elsewhere).

- [ ] **Step 5: Commit**

```bash
git add src/composables/usePlayback.ts
git commit -m "feat: loop playback bounds in startPlayback and progress loop"
```

---

### Task 4: `toggleLoop()` action and restart-while-playing behavior

**Files:**
- Modify: `src/composables/usePlayback.ts` (near `togglePlayback`, `selectMode`, and the return statement)

**Interfaces:**
- Consumes: `isLooping` (Task 2), `isPlaying`, `stopPlayback`, `startPlayback`, `currentTime`, `store.playbackVolume` (all already in this file).
- Produces: `toggleLoop(): Promise<void>`, exported from `usePlayback()`'s return object, consumed by `PlaybackPanel.vue` in Task 5.

- [ ] **Step 1: Add `toggleLoop`**

In `src/composables/usePlayback.ts`, near `selectMode` (just before its closing brace, or directly after it), add:

```ts
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
```

- [ ] **Step 2: Export `isLooping` and `toggleLoop` from the composable**

Find the `return { ... }` block at the end of `usePlayback()`:

```ts
  return {
    isPlaying,
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
  };
```

Add `isLooping` and `toggleLoop`:

```ts
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
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 4: Run the existing test suite**

Run: `npm test -- --run`
Expected: 84 tests passed, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/composables/usePlayback.ts
git commit -m "feat: add toggleLoop action to usePlayback"
```

---

### Task 5: Loop toggle button in `PlaybackPanel.vue`

**Files:**
- Modify: `src/components/PlaybackPanel.vue`

**Interfaces:**
- Consumes: `isLooping: Ref<boolean>` and `toggleLoop(): Promise<void>` from `usePlayback()` (Task 4).
- Produces: nothing consumed elsewhere — this is the leaf UI change.

- [ ] **Step 1: Wrap the Play button in a transport row and add the Loop button**

In `src/components/PlaybackPanel.vue`, find:

```html
      <!-- Play Button -->
      <button
        :class="['btn-play', { playing: isPlaying }]"
        @click="togglePlayback"
      >
        <Icon v-if="!isPlaying" name="play" size="18" />
        <Icon v-else name="pause" size="18" />
        <span>{{ isPlaying ? 'Pause' : 'Play' }}</span>
      </button>
```

Replace with:

```html
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
```

- [ ] **Step 2: Destructure the new composable exports**

Find, in the `<script setup>` block:

```ts
const {
  isPlaying,
  statusMessage,
  activeMode,
  activeSlot,
  currentTime,
  totalTime,
  hasAudio,
  hasReference,
  hasIR,
  togglePlayback: _togglePlayback,
  selectMode,
} = usePlayback();
```

Replace with:

```ts
const {
  isPlaying,
  isLooping,
  statusMessage,
  activeMode,
  activeSlot,
  currentTime,
  totalTime,
  hasAudio,
  hasReference,
  hasIR,
  togglePlayback: _togglePlayback,
  selectMode,
  toggleLoop,
} = usePlayback();
```

- [ ] **Step 3: Add `.transport-row` and `.btn-loop` styles**

In the `<style lang="scss" scoped>` block, find:

```scss
.btn-play {
  padding: 10px;
  border: none;
  border-radius: var(--radius-lg);
  background-color: var(--color-accent);
  color: white;
  font-size: 14px;
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
```

Replace with:

```scss
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
  color: white;
  font-size: 14px;
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
    color: white;
  }
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 5: Run the existing test suite**

Run: `npm test -- --run`
Expected: 84 tests passed, 0 failures.

- [ ] **Step 6: Manual verification via dev server**

Run: `npm run dev`, open the printed local URL in a browser.

Verify by hand:
1. Load an audio file into slot A.
2. Drag a selection on the waveform.
3. Click the new Loop button (repeat icon next to Play) — it should highlight (accent background).
4. Click Play — audio should cycle only within the dragged selection, with no audible click or gap at the wrap point, and the time readout in `.time-display` should cycle between the selection's start/end seconds rather than running to the end of the file.
5. Click Loop again to disable it, then click Play — audio should now play from the current position to the end of the file, not loop.
6. Clear the selection (Reset button, the `rotate-ccw` icon in `WaveformEditor.vue`), enable Loop, press Play — the whole file should loop.
7. While a loop is playing, click the B/C mode buttons (if a reference/IR is available) — playback should restart and loop on the newly active slot's own selection.
8. While a loop is playing, toggle the Loop button off — playback should restart immediately as non-looping.

Report the outcome of each numbered check.

- [ ] **Step 7: Commit**

```bash
git add src/components/PlaybackPanel.vue
git commit -m "feat: add loop toggle button to PlaybackPanel"
```

---

## Testing

This codebase's Vitest suite (`vitest.config.ts`) runs in `environment: 'node'` with no DOM or WebAudio shims, and explicitly excludes `.vue` files from coverage. Existing tests cover only `src/services/**` and `src/utils/**` — pure functions with no Vue reactivity or WebAudio dependency. `usePlayback.ts` and `PlaybackPanel.vue` don't fit that boundary (they depend on `AudioContext`, `AudioBufferSourceNode`, and Vue's reactivity system), and no prior composable or component in this codebase has unit tests either. Consistent with that existing pattern, this feature is verified manually (Task 5, Step 6) rather than by adding a new kind of test infrastructure the codebase doesn't otherwise use.

Each task that touches `.ts` files re-runs the full `npm test -- --run` suite to confirm the change hasn't broken any of the 84 existing tests in `src/services`/`src/utils`, and each task runs `npx vue-tsc --noEmit` to catch type errors immediately rather than letting them accumulate to the end.

## Final Verification

- [ ] **Full test suite**: `npm test -- --run` — 84 tests passed, 0 failures.
- [ ] **Build**: `npm run build` — completes with no errors, confirming the new code is production-buildable and compiles (standalone `vue-tsc` typechecking is unusable in this environment — see Task 1 Step 4).
- [ ] **Manual walkthrough** (Task 5 Step 6) — all 8 checks pass.
