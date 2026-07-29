# UI Animation Polish — Design Spec

Date: 2026-07-28

## Goal

Enrich the existing UI with subtle, smooth animations focused on polish and
feel. No new dependencies, no behavior changes — pure CSS transitions/keyframes
plus Vue's built-in `<Transition>` component, layered onto the current
Vue 3 + SCSS app.

All motion must continue to respect the `prefers-reduced-motion: reduce`
kill-switch already defined in `src/styles/global.scss` (near-zero durations
under that media query) — no per-animation opt-outs needed since the global
rule catches every `animation`/`transition` declaration.

## Current state

- `src/styles/_variables.scss` defines `$transition-fast: 150ms` and
  `$transition-base: 200ms` — reuse these, don't introduce new duration
  constants unless a specific case needs it (documented per-section below).
- `src/styles/components.scss` already defines `@keyframes slideIn`,
  `@keyframes slideInRight`, `.animate-in`, `.animate-in-right`, and a
  `.status-dot { animation: pulse 2s infinite; }` — but `.animate-in` /
  `.animate-in-right` are **dead code**, not referenced from any `.vue` file.
- No component uses Vue's `<Transition>` anywhere in the codebase. Modals
  (`SettingsModal.vue`, `HelpModal.vue`) are toggled with a bare `v-if` in
  `App.vue:72-75` and pop in/out with no transition at all.
- Buttons (`.btn`, `.btn-secondary`, `.btn-icon` in `components.scss`) use
  `transition: all $transition-fast`, which animates every animatable
  property including ones that aren't changing — imprecise and slightly
  wasteful.

## Scope

### 1. Modal enter/exit transitions

Wrap the `SettingsModal` and `HelpModal` usages in `App.vue` (lines 72–75)
each in a Vue `<Transition name="modal">`. Effect: backdrop fades
(opacity 0→1), panel fades and scales from 0.96→1 ("materialize"). ~180ms
ease-out in, matching or slightly faster out.

Both modals define their own `.modal-overlay` / `.modal-content` rules
independently (`SettingsModal.vue:152,162`, `HelpModal.vue:182,192`) rather
than sharing a base class — add the matching
`.modal-enter-active/.modal-leave-active/.modal-enter-from/.modal-leave-to`
rules to each component's own `<style>` block, following that existing
per-component pattern rather than introducing a new shared class.

### 2. Header icon buttons: busy/done states

`App.vue` already toggles `busy` and `done` classes on the compute-spectra
and derive-IR `.btn-icon` buttons (lines 19, 27) based on `computingStep` /
`hasSpectra` / `store.ir`, and both already have *some* styling
(`App.vue:239-261`): `.btn-icon.done` has static accent-colored styling
already; `.btn-icon.busy` already has a continuous `pulse-busy` opacity
animation. Per user preference (spinning icon over pulsing opacity), this
pass **replaces** the pulse with a spin rather than layering both:

- Remove the existing `.btn-icon.busy { animation: pulse-busy ... }` and the
  `@keyframes pulse-busy` rule (`App.vue:249-261`).
- `.btn-icon.busy .feather-icon` spins continuously instead:
  `animation: icon-spin 900ms linear infinite` (named `icon-spin`, not
  `spin`, to avoid colliding with the unrelated `@keyframes spin` already
  scoped inside `SpectrumViewer.vue`).
- `.btn-icon.done` gets a brief one-shot pulse/scale on the transition into
  that state (small `@keyframes done-pulse` scaling ~1 → 1.15 → 1 over
  ~300ms), layered on top of its existing static accent styling — not a
  continuous animation, it should settle back to the static "done"
  appearance already defined.

### 3. Button micro-interactions

In `components.scss`, replace `transition: all $transition-fast` on `.btn`,
`.btn-secondary`, and `.btn-icon` with explicit properties:
`background-color, color, border-color, filter, transform`. Add
`&:active { transform: scale(0.96); }` to `.btn` and `.btn-icon` for tactile
press feedback. `.btn-secondary` inherits `.btn`'s active state as today.

### 4. State-change content transitions

Wrap conditionally-rendered elements that represent a real state change in
Vue `<Transition>`, using the existing (currently unused) `slideIn` keyframe
as the enter animation — small fade + rise (10px), `$transition-base` ease-out:

- Status/error message blocks: `ControlPanel.vue:4` (`.status-message`),
  `PlaybackPanel.vue:86` (`.status`), `RecordingPanel.vue:112`
  (`.status-message`).
- `ImpulseResponseDisplay.vue`: two independent, separately-guarded blocks,
  each gets its own `<Transition>` wrap — the empty-state overlay
  (`v-if="!store.ir"`, line 18) and the populated-IR content
  (`v-if="store.ir"`, line 23). These are not a single mutually-exclusive
  toggle (the canvas underneath stays permanently mounted), so two
  `<Transition>` wraps are needed here, not one. The populated block is
  currently a bare `<template v-if="store.ir">` wrapping several sibling
  elements (metadata, control-rows, actions) — since `<Transition>` requires
  a single root element, this task also wraps those siblings in one
  `<div class="ir-populated">` container as the `<Transition>`'s child.
- `SpectrumViewer.vue`'s loading overlay (line 11, `.overlay.loading-state`).
  Note this component already defines its own `@keyframes spin` (line 135,
  600ms, used by `.spinner`) — unrelated to and independent from the
  `icon-spin` keyframe introduced in section 2; no change needed here beyond
  wrapping the overlay's `v-if` in a `<Transition>`.

Static layout (panels/sections that are always present, like the main
three-column app shell) does **not** animate on initial load — this pass
only animates elements when their `v-if` condition actually flips during
use, not on first mount.

The dead `.animate-in` class becomes live via these `<Transition>` usages
(Vue's transition classes are separate from `.animate-in`, but the
`slideIn` keyframe itself is now shared/reused between them — see
Implementation note below). `.animate-in-right` / `slideInRight` are not
used by this pass; `.toast-container` in `App.vue:78` is empty/unused
and out of scope — left as-is.

### 5. Slider thumb transition cleanup

`components.scss`'s `.slider input[type="range"]` thumb (`::-webkit-slider-thumb`,
`::-moz-range-thumb`) already scales on hover. Tighten
`transition: all $transition-fast` to `transition: transform $transition-fast,
background-color $transition-fast` — no behavior change, consistent with #3.

## Implementation note

Vue's `<Transition>` needs CSS classes named `<name>-enter-active` etc., not
a bare `animation: slideIn ...` rule. The cleanest approach: define the
`slideIn` keyframe once in `components.scss` (already there), and in each
consuming component's `<style>` block add a scoped `<Transition name="fade-rise">`
block that references it via `animation: slideIn $transition-base ease-out`
on `.fade-rise-enter-active`, with `.fade-rise-leave-active { transition:
opacity $transition-fast; }` for a plain fade-out (no reverse-slide, keeps
exits simple). This keeps the keyframe centralized while each component owns
its own transition wiring, matching the existing per-component style pattern
in this codebase.

## Out of scope

- Wiring up `.toast-container` (currently empty/unused).
- Animating the main app shell/panels on initial page load.
- Spectrum plot (Plotly) internal animations — out of reach of CSS, separate
  concern.
- New animation duration tokens beyond `$transition-fast` / `$transition-base`
  unless implementation reveals a genuine need (e.g. the modal scale or
  done-pulse keyframes may need their own short duration constants — if so,
  add them to `_variables.scss` following the existing naming convention).

## Testing

Manual verification in browser (dev server) for each of the 5 areas above,
in both light and dark theme, plus a check with `prefers-reduced-motion:
reduce` emulated in devtools to confirm the global kill-switch still
suppresses all new animations correctly.
