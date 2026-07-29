# SCSS cleanup: close gaps left by the SCSS conversion

## Context

`3511004 feat: convert all to SCSS` converted component `<style>` blocks to
`lang="scss"` but missed `src/styles/global.css` and `src/styles/components.css`
(still `.css`) and `App.vue` (still a plain, non-SCSS `<style>` block). As a
result:

- `App.vue` redeclares `.btn-icon` and `.panel-side-bg` with **different,
  hardcoded** values than the shared definitions in `components.css`, instead
  of reusing them.
- `App.vue` hardcodes `#242424` / `#DCDCDC` for its header background — the
  same values already exposed as `--color-modal-header` in `global.css` — and
  hardcodes `#2A2A2A` / `#ECECEC` for `.panel-side-bg`, diverging from
  `components.css`'s accent-tinted `rgba(37, 99, 235, ...)` version of the
  same class.
- `components.css` has one stray non-token color: `.btn:hover` darkens
  `--color-accent` with a hardcoded `#1d4fa8`, which doesn't track the accent
  color in dark mode.
- The "theme override" pattern — a `@media (prefers-color-scheme: X)` block
  plus a `:root[data-theme="X"] &` block carrying the same property value —
  is hand-copied 4+ times across `App.vue`, `components.css`, and
  `global.css`, with inconsistent conventions for which theme is the
  "default" unscoped rule.
- `150ms` (transition duration) appears ~15 times across component files;
  `999px` (pill radius) appears twice. Neither is backed by a variable the
  way `--radius-sm/md/lg` already covers other radii.

## Goal

Close the two gaps (files not converted) and remove the concrete duplication
bugs, using a small shared SCSS partial for the handful of values/patterns
that actually repeat. Not a general design-system rewrite — YAGNI on anything
that only appears once or twice.

## Changes

### 1. Convert remaining files to `.scss`
- `src/styles/global.css` → `src/styles/global.scss`
- `src/styles/components.css` → `src/styles/components.scss`
- `App.vue`'s plain `<style>` → `<style lang="scss">` (its second block is
  already `<style scoped>`; convert to `<style scoped lang="scss">`)
- Update the two `@import` paths in `App.vue`'s first style block accordingly.
- No `vite.config.ts` changes needed — `sass` is already a dependency and Vite
  resolves `.scss` out of the box.

### 2. New partial: `src/styles/_variables.scss`
SCSS-only (compile-time) constants for values that repeat 3+ times and aren't
already CSS custom properties (custom properties stay in `global.scss` since
they must remain runtime-switchable for the light/dark toggle):

```scss
$transition-fast: 150ms;
$transition-base: 200ms;
$radius-pill: 999px;
```

### 3. New partial: `src/styles/_mixins.scss`
One mixin to replace the repeated 4-block theme-override pattern:

```scss
@mixin themed($property, $dark, $light) {
  #{$property}: $dark;

  @media (prefers-color-scheme: light) {
    #{$property}: $light;
  }
  :root[data-theme="light"] & {
    #{$property}: $light;
  }
  :root[data-theme="dark"] & {
    #{$property}: $dark;
  }
}
```
Dark is treated as the base/unscoped value (matches this app's existing
`currentTheme` default of `'dark'` in `App.vue`). Usage nested inside a
selector, e.g.:
```scss
.panel-side-bg {
  @include themed(background-color, #2A2A2A, #ECECEC);
}
```
This only replaces the *component-selector* instances of the pattern
(`App.vue`, `components.scss`'s `.panel-side-bg`). `global.scss`'s
`:root[data-theme="dark"] { --color-bg: ...; ... }` blocks reassign many
custom properties at once at the root itself — a different shape — and stay
hand-written as the single source of truth for the tokens.

Both partials are `@use`d (not `@import`ed) by `global.scss`,
`components.scss`, and `App.vue`'s style block.

### 4. Fix the concrete bugs
- `components.scss`: `.btn:hover` uses `var(--color-accent)` with
  `filter: brightness(1.1)` for the hover darken instead of the hardcoded
  `#1d4fa8` (the `filter` is already present and does the same job — the
  hardcoded color is redundant/wrong, not additive).
- `App.vue`'s `.btn-icon` is `scoped`, so its attribute-selector specificity
  currently wins over `components.scss`'s global `.btn-icon` — App.vue's copy
  is the one actually rendering today. It's missing `display: inline-flex`
  (present in the global version) and it's the only one with a `:disabled`
  dimming rule (`opacity: 0.35; cursor: not-allowed;`), which the global
  version lacks. Merge: add `display: inline-flex` and the `:disabled` rule
  to `components.scss`'s `.btn-icon`, then delete App.vue's duplicate block
  entirely. Verify visually after removal (header icon buttons, including a
  disabled one, e.g. before any audio is loaded).
- `App.vue`: `.panel-side-bg` and the header background keep App.vue's
  hardcoded grey values (that's the intentional distinct look for those two
  surfaces) but expressed via `@include themed(...)` instead of the
  copy-pasted triple block, and the header's `#242424`/`#DCDCDC` reuse
  `var(--color-modal-header)` instead of restating the literal.
- `App.vue`: `border-radius: 8px` / `12px` on `.btn-icon` / `.panel` become
  `var(--radius-sm)` / `var(--radius-md)`.

## Out of scope
- No visual/behavior changes — this is a like-for-like refactor of how
  existing values are expressed, not new theming.
- Not touching the `rgba()` one-offs in `ImpulseResponseDisplay.vue` /
  `WaveformEditor.vue` (spectrum-plot colors) — they don't repeat elsewhere
  and aren't part of the shared token system.
- No mixin for spacing/grid values — `components.scss`'s `.grid-2/.grid-3`
  and gap values are simple enough as-is.
