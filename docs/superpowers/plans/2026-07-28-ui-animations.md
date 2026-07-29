# UI Animation Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add subtle, smooth CSS/Vue-`<Transition>`-based animations across the existing Vue 3 + SCSS app (modal enter/exit, busy/done button feedback, button press micro-interactions, state-change content transitions, slider cleanup) without adding dependencies or changing app behavior.

**Architecture:** Pure CSS transitions/keyframes plus Vue's built-in `<Transition>` component, layered onto existing component `<style lang="scss" scoped>` blocks. No JS animation libraries. Every new animation is automatically neutralized by the existing global `prefers-reduced-motion: reduce` rule in `src/styles/global.scss:255-261` (it overrides `animation-duration`/`transition-duration` on `*`), so no per-component reduced-motion handling is needed.

**Tech Stack:** Vue 3 `<Transition>`, SCSS (`$transition-fast` = 150ms, `$transition-base` = 200ms from `src/styles/_variables.scss`), CSS `@keyframes`.

## Global Constraints

- No new npm dependencies.
- Reuse `$transition-fast` (150ms) / `$transition-base` (200ms) from `src/styles/_variables.scss` wherever a duration is needed; only add a new SCSS variable if a specific effect genuinely needs a duration neither covers (document why, in that task).
- All new `animation`/`transition` rules are automatically covered by the existing `@media (prefers-reduced-motion: reduce)` block in `src/styles/global.scss:255-261` — do not add per-component `prefers-reduced-motion` overrides.
- Match each file's existing SCSS import pattern: components using `@use '../styles/variables' as *;` (and `mixins` where already imported) inside `<style lang="scss" scoped>` — follow what that specific file already does, don't introduce `@import` in files that use `@use` or vice versa.
- No behavior changes — every task is purely visual/CSS, verified by manual browser check (`npm run dev`), not by unit tests (this codebase's Vitest suite covers DSP/audio logic, not CSS).
- Manual verification for every task: check in both light and dark theme (toggle via the header sun/moon button), and with Chrome DevTools' "Emulate CSS prefers-reduced-motion: reduce" toggled on to confirm animations collapse to near-zero duration.

---

### Task 1: Modal enter/exit transitions

**Files:**
- Modify: `src/App.vue:72-75`
- Modify: `src/components/SettingsModal.vue` (style block starts line 148)
- Modify: `src/components/HelpModal.vue` (style block starts line 177)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by later tasks (modal transition is self-contained).

- [ ] **Step 1: Wrap both modal usages in `<Transition name="modal">` in App.vue**

In `src/App.vue`, replace lines 72–75:

```html
    <!-- Settings Modal -->
    <SettingsModal v-if="showSettings" @close="showSettings = false" />

    <!-- Help Modal -->
    <HelpModal v-if="showHelp" @close="showHelp = false" />
```

with:

```html
    <!-- Settings Modal -->
    <Transition name="modal">
      <SettingsModal v-if="showSettings" @close="showSettings = false" />
    </Transition>

    <!-- Help Modal -->
    <Transition name="modal">
      <HelpModal v-if="showHelp" @close="showHelp = false" />
    </Transition>
```

- [ ] **Step 2: Add modal transition CSS to SettingsModal.vue**

In `src/components/SettingsModal.vue`, inside the existing `<style lang="scss" scoped>` block (starts line 148), immediately after the `.modal-overlay { ... }` rule (ends line 160), add:

```scss
.modal-enter-active,
.modal-leave-active {
  transition: opacity $transition-base ease-out;

  .modal-content {
    transition: opacity $transition-base ease-out, transform $transition-base ease-out;
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .modal-content {
    opacity: 0;
    transform: scale(0.96);
  }
}
```

- [ ] **Step 3: Add identical modal transition CSS to HelpModal.vue**

In `src/components/HelpModal.vue`, inside the existing `<style lang="scss" scoped>` block (starts line 177), immediately after the `.modal-overlay { ... }` rule (ends line 190), add the same block as Step 2:

```scss
.modal-enter-active,
.modal-leave-active {
  transition: opacity $transition-base ease-out;

  .modal-content {
    transition: opacity $transition-base ease-out, transform $transition-base ease-out;
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .modal-content {
    opacity: 0;
    transform: scale(0.96);
  }
}
```

- [ ] **Step 4: Verify in browser**

Run `npm run dev`, open the app. Click the Settings icon (gear) in the header — the backdrop should fade in and the panel should fade+scale up from 96%. Close it (X button or click backdrop) — same effect in reverse. Repeat for the Help icon. Check both light and dark theme. Check with DevTools "Emulate CSS prefers-reduced-motion: reduce" — the transition should collapse to near-instant.

- [ ] **Step 5: Commit**

```bash
git add src/App.vue src/components/SettingsModal.vue src/components/HelpModal.vue
git commit -m "feat: animate modal enter/exit with fade+scale transition"
```

---

### Task 2: Header icon busy/done states — replace pulse with spin, add done-pulse

**Files:**
- Modify: `src/App.vue:239-261`

**Interfaces:**
- Consumes: `Icon.vue` renders its root SVG with class `feather-icon` (confirmed at `src/components/Icon.vue:12`) — the spin animation targets `.btn-icon.busy .feather-icon`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the busy pulse with an icon spin, and add a done-pulse keyframe**

In `src/App.vue`, replace lines 239–261:

```scss
.btn-icon.done {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background-color: color-mix(in srgb, var(--color-accent) 12%, transparent);

  &:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-accent) 22%, transparent);
  }
}

.btn-icon.busy {
  color: var(--color-accent);
  animation: pulse-busy 900ms ease-in-out infinite;
}

@keyframes pulse-busy {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
```

with:

```scss
.btn-icon.done {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background-color: color-mix(in srgb, var(--color-accent) 12%, transparent);
  animation: done-pulse 300ms ease-out;

  &:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-accent) 22%, transparent);
  }
}

.btn-icon.busy {
  color: var(--color-accent);

  .feather-icon {
    animation: icon-spin 900ms linear infinite;
  }
}

@keyframes icon-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes done-pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.15);
  }
  100% {
    transform: scale(1);
  }
}
```

Note: named `icon-spin` (not `spin`) deliberately — `src/components/SpectrumViewer.vue` already defines its own scoped `@keyframes spin`; using a distinct name here avoids any ambiguity about Vue's scoped-CSS keyframe handling.

- [ ] **Step 2: Verify in browser**

Run `npm run dev`. Load two audio files (A and B) so the "Compute Spectrum" button becomes enabled, then click it — the icon should spin continuously while computing, then briefly pulse-scale once when it flips to "done" (accent-colored, checkmark-style border) and settle. Repeat for "Derive IR". Check both themes and reduced-motion emulation.

- [ ] **Step 3: Commit**

```bash
git add src/App.vue
git commit -m "feat: spin busy icons and pulse done state on header action buttons"
```

---

### Task 3: Button micro-interactions — press scale + explicit transition properties

**Files:**
- Modify: `src/styles/components.scss:1-77` (`.btn`, `.btn-secondary`, `.btn-icon` rules)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update `.btn` and `.btn-icon` transitions and add press scale**

In `src/styles/components.scss`, replace the `.btn` block (lines 5–32):

```scss
.btn {
  padding: 8px 12px;
  border: none;
  border-radius: var(--radius-lg);
  background-color: var(--color-accent);
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all $transition-fast;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  user-select: none;

  &:hover {
    filter: brightness(1.1);
  }

  &:active {
    filter: brightness(0.95);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
```

with:

```scss
.btn {
  padding: 8px 12px;
  border: none;
  border-radius: var(--radius-lg);
  background-color: var(--color-accent);
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color $transition-fast, color $transition-fast,
    filter $transition-fast, transform $transition-fast;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  user-select: none;

  &:hover {
    filter: brightness(1.1);
  }

  &:active {
    filter: brightness(0.95);
    transform: scale(0.96);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
```

- [ ] **Step 2: Update `.btn-icon` transitions and add press scale**

In the same file, replace the `.btn-icon` block (lines 55–77):

```scss
.btn-icon {
  padding: 8px;
  border-radius: var(--radius-sm);
  background-color: transparent;
  border: 1px solid var(--color-border);
  cursor: pointer;
  color: var(--color-text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all $transition-fast;
  font-size: 16px;

  &:hover:not(:disabled) {
    background-color: var(--color-border);
    color: var(--color-text-primary);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
}
```

with:

```scss
.btn-icon {
  padding: 8px;
  border-radius: var(--radius-sm);
  background-color: transparent;
  border: 1px solid var(--color-border);
  cursor: pointer;
  color: var(--color-text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color $transition-fast, color $transition-fast,
    border-color $transition-fast, transform $transition-fast;
  font-size: 16px;

  &:hover:not(:disabled) {
    background-color: var(--color-border);
    color: var(--color-text-primary);
  }

  &:active:not(:disabled) {
    transform: scale(0.96);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
}
```

Note: `.btn-icon.done` (from Task 2) already sets `animation: done-pulse 300ms ease-out` — that's a separate `animation` property from this `transition` property, so they don't conflict, but confirm in Step 3 that pressing a `.done` icon button still shows the press-scale on top of its resting `done` appearance.

- [ ] **Step 3: Verify in browser**

Run `npm run dev`. Click and hold various `.btn` buttons (e.g. "48 kHz" download button in the IR panel) and `.btn-icon` buttons (header icons) — each should scale down slightly on press and back on release, in addition to existing hover/brightness changes. Confirm `.btn-secondary` (which inherits `.btn`'s `&:active`) also gets the press scale. Check both themes.

- [ ] **Step 4: Commit**

```bash
git add src/styles/components.scss
git commit -m "feat: add press-scale feedback and tighten button transitions"
```

---

### Task 4: Status message transitions (ControlPanel, PlaybackPanel, RecordingPanel)

**Files:**
- Modify: `src/components/ControlPanel.vue` (template line 4, style block starts line 106)
- Modify: `src/components/PlaybackPanel.vue` (template line 86, style block starts line 149)
- Modify: `src/components/RecordingPanel.vue` (template line 112, style block starts line 328)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: establishes the `fade-rise` transition-name pattern reused by Task 5 (same CSS shape, each component defines its own copy in its own scoped `<style>` block — no shared class, per the existing per-component styling pattern in this codebase).

- [ ] **Step 1: Wrap ControlPanel's status message in a Transition**

In `src/components/ControlPanel.vue`, replace template line 4:

```html
    <div v-if="statusMessage" class="status-message">
```

with a `<Transition>` wrap around the existing `v-if` div (keep the div and its content exactly as-is, just add the wrapper):

```html
    <Transition name="fade-rise">
      <div v-if="statusMessage" class="status-message">
        {{ statusMessage }}
      </div>
    </Transition>
```

This replaces the original lines 4–6 (`<div v-if="statusMessage" class="status-message">`, `{{ statusMessage }}`, `</div>`) with the block above.

- [ ] **Step 2: Add fade-rise transition CSS to ControlPanel.vue**

In `src/components/ControlPanel.vue`, inside the `<style lang="scss" scoped>` block (starts line 106), immediately after the existing `.status-message { ... }` rule (starts line 258 pre-edit — locate it after Step 1's template change, it does not move since it's in the separate style block), add:

```scss
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
```

- [ ] **Step 3: Wrap PlaybackPanel's status message in a Transition**

In `src/components/PlaybackPanel.vue`, replace template line 86 through its closing tag:

```html
      <div v-if="statusMessage" class="status">
        {{ statusMessage }}
      </div>
```

with:

```html
      <Transition name="fade-rise">
        <div v-if="statusMessage" class="status">
          {{ statusMessage }}
        </div>
      </Transition>
```

- [ ] **Step 4: Add fade-rise transition CSS to PlaybackPanel.vue**

In `src/components/PlaybackPanel.vue`, inside the `<style lang="scss" scoped>` block (starts line 149), after the existing `.status { ... }` rule (ends line 308), add the same block as Step 2:

```scss
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
```

- [ ] **Step 5: Wrap RecordingPanel's status message in a Transition**

In `src/components/RecordingPanel.vue`, replace template line 112 through its closing tag:

```html
      <div v-if="statusMessage" class="status-message">
        {{ statusMessage }}
      </div>
```

with:

```html
      <Transition name="fade-rise">
        <div v-if="statusMessage" class="status-message">
          {{ statusMessage }}
        </div>
      </Transition>
```

- [ ] **Step 6: Add fade-rise transition CSS to RecordingPanel.vue**

In `src/components/RecordingPanel.vue`, inside the `<style lang="scss" scoped>` block (starts line 328), after the existing `.status-message { ... }` rule (starts line 419), add the same block as Step 2:

```scss
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
```

- [ ] **Step 7: Verify in browser**

Run `npm run dev`. Trigger a status message in each of the three panels (e.g. load a file to trigger ControlPanel/RecordingPanel status text, play/pause audio to trigger PlaybackPanel status) — each should fade+rise in (~10px, from below) and fade out cleanly when cleared. Check both themes and reduced-motion emulation.

- [ ] **Step 8: Commit**

```bash
git add src/components/ControlPanel.vue src/components/PlaybackPanel.vue src/components/RecordingPanel.vue
git commit -m "feat: animate status messages with fade-rise transition"
```

---

### Task 5: ImpulseResponseDisplay and SpectrumViewer overlay transitions

**Files:**
- Modify: `src/components/ImpulseResponseDisplay.vue` (template lines 18-20, 23-82ish, style block starts line 309)
- Modify: `src/components/SpectrumViewer.vue` (template line 11, style block starts line 69)

**Interfaces:**
- Consumes: the `fade-rise` transition-name CSS shape established in Task 4 (each component defines its own copy — no shared import).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Wrap ImpulseResponseDisplay's empty-state overlay in a Transition**

In `src/components/ImpulseResponseDisplay.vue`, replace template lines 18–20:

```html
        <div v-if="!store.ir" class="overlay">
          <p>Derive IR to display</p>
        </div>
```

with:

```html
        <Transition name="fade-rise">
          <div v-if="!store.ir" class="overlay">
            <p>Derive IR to display</p>
          </div>
        </Transition>
```

- [ ] **Step 2: Wrap the populated-IR block in a single root div and a Transition**

In the same file, find the `<template v-if="store.ir">` block. It starts at line 23 (pre-Step-1) and its matching closing `</template>` is on its own line, immediately after the `.actions` div's closing `</div>` and before the outer `.ir-content` div's closing `</div>` — in the unmodified file this is line 81 (`      </template>`), two lines before the end of the `<template>` root at line 84. Step 1 adds 4 lines above this block, so re-locate the tag by searching for the literal text `</template>` immediately preceded by `      </div>\n` (the `.actions` div close) rather than trusting the line number.

Replace:

```html
      <template v-if="store.ir">
      <!-- Metadata -->
      <div class="metadata">
```

with:

```html
      <Transition name="fade-rise">
      <div v-if="store.ir" class="ir-populated">
      <!-- Metadata -->
      <div class="metadata">
```

And replace the matching closing `</template>` (the one that closes this same conditional block) with:

```html
      </div>
      </Transition>
```

Leave all content between the metadata div and the closing tag exactly as-is — only the opening `<template v-if="store.ir">` → `<Transition><div v-if="store.ir" class="ir-populated">` and closing `</template>` → `</div></Transition>` change.

- [ ] **Step 3: Add fade-rise transition CSS and ir-populated layout rule to ImpulseResponseDisplay.vue**

In `src/components/ImpulseResponseDisplay.vue`, inside the `<style lang="scss" scoped>` block (starts line 309), after the existing `.overlay { ... }` rule (starts line 332), add:

```scss
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
```

`.ir-populated` is deliberately given the same `display: flex; flex-direction: column; gap: $gap;` layout as its parent `.ir-content` (`$gap: 12px`, defined at line 313), so wrapping `.metadata`, `.control-row`, and `.actions` in this extra div doesn't change their visual spacing as siblings-of-siblings. Do **not** use `display: contents` here even though it seems like the more "transparent" choice — elements with `display: contents` do not render `opacity` or `transform` animations in any current browser (no box is generated to paint or transform), so the `fade-rise` transition would silently fail to play on this block specifically, while still working everywhere else.

- [ ] **Step 4: Wrap SpectrumViewer's loading overlay in a Transition**

In `src/components/SpectrumViewer.vue`, replace template line 11 through its closing tag:

```html
      <div v-if="store.isAutoComputing" class="overlay loading-state">
        <div class="spinner"></div>
        <p>Computing spectra...</p>
      </div>
```

with:

```html
      <Transition name="fade-rise">
        <div v-if="store.isAutoComputing" class="overlay loading-state">
          <div class="spinner"></div>
          <p>Computing spectra...</p>
        </div>
      </Transition>
```

- [ ] **Step 5: Add fade-rise transition CSS to SpectrumViewer.vue**

In `src/components/SpectrumViewer.vue`, inside the `<style lang="scss" scoped>` block (starts line 69), after the existing `.overlay { ... }` rule (starts line 102), add:

```scss
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
```

Note: this file already has its own unrelated `@keyframes spin` (line 135, used by `.spinner`) — the new `slideIn` keyframe added here is a separate, independent name, no collision.

- [ ] **Step 6: Verify in browser**

Run `npm run dev`. Load two files, click "Compute Spectrum" — the loading overlay (spinner + "Computing spectra...") should fade+rise in on appearing and fade out on completion. Then click "Derive IR" — the "Derive IR to display" empty-state should fade out, and the populated metadata/actions content should **visibly fade+rise in** (not just appear instantly) — this is the specific thing to check, since a `display: contents` mistake on `.ir-populated` would make the layout look correct while the animation itself silently doesn't play. Also confirm the IR panel's layout (metadata rows, dropdowns, download buttons) looks identical to before this change once populated — no spacing shift from the new wrapper div. Check both themes and reduced-motion emulation.

- [ ] **Step 7: Commit**

```bash
git add src/components/ImpulseResponseDisplay.vue src/components/SpectrumViewer.vue
git commit -m "feat: animate IR display and spectrum overlay state transitions"
```

---

### Task 6: Slider thumb transition cleanup

**Files:**
- Modify: `src/styles/components.scss:99-144`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Tighten the slider thumb transitions**

In `src/styles/components.scss`, in the `.slider` block, replace both occurrences of:

```scss
      transition: all $transition-fast;
```

(one inside `&::-webkit-slider-thumb { ... }` around line 123, one inside `&::-moz-range-thumb { ... }` around line 137) with:

```scss
      transition: transform $transition-fast, background-color $transition-fast;
```

- [ ] **Step 2: Verify in browser**

Run `npm run dev`. Hover over any range slider (e.g. FFT settings in ControlPanel, or the Advanced Settings modal) — the thumb should still scale up smoothly on hover exactly as before, no visible behavior change. Check both themes.

- [ ] **Step 3: Commit**

```bash
git add src/styles/components.scss
git commit -m "chore: tighten slider thumb transition to explicit properties"
```

---

## Post-plan cleanup note (not a task — informational)

The pre-existing `.animate-in` / `.animate-in-right` classes and `slideInRight` keyframe in `src/styles/components.scss` (lines 280-297 as of spec-writing) remain unused after this plan — this plan does not touch or remove them (per user decision during brainstorming: "Yes, looks right" on a scope that keeps them out of scope). Each task above adds its own local `@keyframes slideIn` copy per component rather than consuming the one in `components.scss`, following the per-component styling pattern already established in this codebase (e.g. `.modal-overlay` duplicated in both modals rather than shared).
