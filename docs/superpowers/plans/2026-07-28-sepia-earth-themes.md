# Sepia & Earth Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new themes, `sepia` (light) and `earth` (dark), derived
from a user-supplied warm/earthy palette, bringing the app from 2 themes to
4, with the toggle button cycling through all four.

**Architecture:** Add two new `:root[data-theme="..."]` CSS variable blocks
in `global.scss`. Restructure the binary `themed()` Sass mixin into a 4-way
mixin with backward-compatible defaults. Extract a single `Theme` type in
`App.vue` and replace the 2-state toggle with an N-state cycle over a fixed
theme order, driven by a `Record<Theme, {...}>` icon/title lookup.

**Tech Stack:** Vue 3 `<script setup lang="ts">`, Sass (`@use`/`@mixin`),
`feather-icons`, `localStorage`.

## Global Constraints

- Existing `light` and `dark` theme token values in `global.scss` do not
  change.
- Status colors (`--color-success`, `--color-error`, `--color-warning`)
  are identical across all four themes — never themed per-palette.
- New theme names are `sepia` and `earth` (used verbatim as the
  `data-theme` attribute value and the `localStorage['theme']` value).
- Cycle order is fixed: `light → dark → sepia → earth → light → ...`.
- Sepia icon is `coffee`, Earth icon is `droplet` (both confirmed present
  in `node_modules/feather-icons/dist/icons.json`).
- `themed()` mixin new signature:
  `@mixin themed($property, $light, $dark, $sepia: $light, $earth: $dark)`
  — note the parameter order is `$light` before `$dark` (previously
  `$dark` before `$light`), so every existing call site's argument order
  must be swapped, not just extended.

---

### Task 1: Add Sepia and Earth CSS variable blocks

**Files:**
- Modify: `src/styles/global.scss:88` (after the existing
  `:root[data-theme="light"]` block ends)

**Interfaces:**
- Produces: `:root[data-theme="sepia"]` and `:root[data-theme="earth"]`
  selectors, each defining the full CSS custom property set consumed by
  every other component in the app (`--color-bg`, `--color-text-primary`,
  `--color-text-secondary`, `--color-accent`, `--color-spectrum-a`,
  `--color-spectrum-b`, `--color-border`, `--color-success`,
  `--color-error`, `--color-warning`, `--color-modal-bg`,
  `--color-modal-header`).

- [ ] **Step 1: Add the two new `:root[data-theme]` blocks**

Insert after line 105 (the closing `}` of the existing
`:root[data-theme="light"]` block) in `src/styles/global.scss`:

```scss
:root[data-theme="sepia"] {
  color-scheme: light;

  --color-bg: #FFE8D6;
  --color-text-primary: #6B705C;
  --color-text-secondary: #A5A58D;
  --color-accent: #CB997E;
  --color-spectrum-a: #CB997E;
  --color-spectrum-b: #B7B7A4;
  --color-border: #DDBEA9;
  --color-success: #34C759;
  --color-error: #FF3B30;
  --color-warning: #FF9500;
  --color-modal-bg: #DDBEA9;
  --color-modal-header: #CB997E;
}

:root[data-theme="earth"] {
  color-scheme: dark;

  --color-bg: #6B705C;
  --color-text-primary: #FFE8D6;
  --color-text-secondary: #DDBEA9;
  --color-accent: #CB997E;
  --color-spectrum-a: #CB997E;
  --color-spectrum-b: #DDBEA9;
  --color-border: #A5A58D;
  --color-success: #30B94D;
  --color-error: #FF6961;
  --color-warning: #FF9F0A;
  --color-modal-bg: #5A5F4D;
  --color-modal-header: #7D8268;
}
```

Note: `--color-success/error/warning` for `sepia` reuse the exact light-theme
values (lines 18-20 of the same file); `earth` reuses the exact dark-theme
values (lines 67-69).

- [ ] **Step 2: Visually sanity-check the file**

Run: `grep -c "data-theme=" src/styles/global.scss`
Expected: `4` (light, dark, sepia, earth)

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.scss
git commit -m "feat: add sepia and earth theme CSS variable blocks"
```

---

### Task 2: Restructure the `themed()` mixin to support 4 themes

**Files:**
- Modify: `src/styles/_mixins.scss:1-16`

**Interfaces:**
- Consumes: nothing (pure Sass, no upstream dependency).
- Produces: `@mixin themed($property, $light, $dark, $sepia: $light, $earth: $dark)`
  — callers pass a CSS property name and the value for each named theme;
  `$sepia`/`$earth` are optional and default to `$light`/`$dark`.

- [ ] **Step 1: Rewrite the mixin**

Replace the full contents of `src/styles/_mixins.scss` lines 1-16 with:

```scss
// Sets $property per theme. $light/$dark are required and also drive the
// OS-level prefers-color-scheme fallback (sepia/earth are explicit-selection
// only — there's no OS equivalent for them). $sepia/$earth default to
// $light/$dark so existing call sites that only care about light vs. dark
// don't need to change.
@mixin themed($property, $light, $dark, $sepia: $light, $earth: $dark) {
  #{$property}: $dark;

  @media (prefers-color-scheme: light) {
    #{$property}: $light;
  }

  $theme-values: (
    'light': $light,
    'dark': $dark,
    'sepia': $sepia,
    'earth': $earth,
  );

  @each $theme, $value in $theme-values {
    :root[data-theme="#{$theme}"] & {
      #{$property}: $value;
    }
  }
}
```

- [ ] **Step 2: Update the existing call site in `components.scss`**

`src/styles/components.scss:155` currently reads (old signature,
`$dark` first):

```scss
.panel-side-bg {
  @include themed(background-color, #2A2A2A, #ECECEC);
}
```

Change the argument order to match the new `$light, $dark` signature:

```scss
.panel-side-bg {
  @include themed(background-color, #ECECEC, #2A2A2A);
}
```

(This preserves the exact same rendered behavior for `light`/`dark` — only
the argument order changed, not the values. `sepia` and `earth` will
default to `#ECECEC` and `#2A2A2A` respectively via the new defaults,
which is correct: this call site hasn't been given theme-specific values
yet.)

- [ ] **Step 3: Update the existing call site in `App.vue`**

`src/App.vue:223` currently reads (old signature, `$dark` first):

```scss
.app-logo {
  height: 36px;
  width: auto;
  @include themed(filter, invert(1), none);
}
```

Change to the new `$light, $dark` argument order, and add explicit
`$earth` since Earth is a dark-character theme and needs the same invert
as Dark:

```scss
.app-logo {
  height: 36px;
  width: auto;
  @include themed(filter, none, invert(1), $earth: invert(1));
}
```

(`$sepia` is omitted — it defaults to `$light` = `none`, which is correct
since Sepia is a light-character theme.)

- [ ] **Step 4: Run the dev build to confirm the Sass compiles**

Run: `npm run build`
Expected: build succeeds with no Sass errors (undefined mixin args, etc.)

- [ ] **Step 5: Commit**

```bash
git add src/styles/_mixins.scss src/styles/components.scss src/App.vue
git commit -m "feat: restructure themed() mixin to support 4 themes"
```

---

### Task 3: Migrate `HelpModal.vue`'s hardcoded theme selector to the mixin

**Files:**
- Modify: `src/components/HelpModal.vue:178` (imports), `:267-273`
  (`.about-logo` rule)

**Interfaces:**
- Consumes: `themed()` mixin from Task 2
  (`@mixin themed($property, $light, $dark, $sepia: $light, $earth: $dark)`).
- Produces: `.about-logo` filter behavior consistent with `.app-logo` in
  `App.vue` — no invert for `light`/`sepia`, invert for `dark`/`earth`.

- [ ] **Step 1: Add the mixins import**

`src/components/HelpModal.vue:178` currently has only:

```scss
@use '../styles/variables' as *;
```

Add the mixins import alongside it:

```scss
@use '../styles/variables' as *;
@use '../styles/mixins' as *;
```

- [ ] **Step 2: Replace the hardcoded selector**

`src/components/HelpModal.vue:267-273` currently reads:

```scss
.about-logo {
  height: 56px;
  width: auto;
  filter: invert(1);

  :root[data-theme="light"] & { filter: none; }
}
```

Replace with:

```scss
.about-logo {
  height: 56px;
  width: auto;
  @include themed(filter, none, invert(1), $earth: invert(1));
}
```

- [ ] **Step 3: Run the dev build to confirm the Sass compiles**

Run: `npm run build`
Expected: build succeeds with no Sass errors (unresolved mixin, etc.)

- [ ] **Step 4: Commit**

```bash
git add src/components/HelpModal.vue
git commit -m "fix: migrate HelpModal about-logo filter to themed() mixin"
```

---

### Task 4: Extract `Theme` type and cycle order in `App.vue`

**Files:**
- Modify: `src/App.vue:86-131` (script section)

**Interfaces:**
- Produces: `type Theme = 'light' | 'dark' | 'sepia' | 'earth'`;
  `const THEME_ORDER: Theme[]`; `isValidTheme(value: string | null): value is Theme`.
  These are consumed by Task 5 (icon/title lookup) and Task 6 (cycle
  button wiring) in this same file.

- [ ] **Step 1: Add the `Theme` type and order constant**

In `src/App.vue`, immediately after the existing imports (after line 99,
before `const store = useAnalysisStore();`), add:

```ts
type Theme = 'light' | 'dark' | 'sepia' | 'earth';

const THEME_ORDER: Theme[] = ['light', 'dark', 'sepia', 'earth'];

function isValidTheme(value: string | null): value is Theme {
  return value !== null && (THEME_ORDER as string[]).includes(value);
}
```

- [ ] **Step 2: Replace the inlined union types**

Change line 106 from:

```ts
const currentTheme = ref<'light' | 'dark'>('dark');
```

to:

```ts
const currentTheme = ref<Theme>('dark');
```

- [ ] **Step 3: Update `initTheme()` to validate the stored value**

Replace lines 116-121:

```ts
function initTheme(): void {
  const saved = localStorage.getItem('theme') as 'light' | 'dark' | null;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  currentTheme.value = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(currentTheme.value);
}
```

with:

```ts
function initTheme(): void {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  currentTheme.value = isValidTheme(saved) ? saved : (prefersDark ? 'dark' : 'light');
  applyTheme(currentTheme.value);
}
```

- [ ] **Step 4: Update `applyTheme()`'s parameter type**

Change line 123 from:

```ts
function applyTheme(theme: 'light' | 'dark'): void {
```

to:

```ts
function applyTheme(theme: Theme): void {
```

(Body is unchanged — it already just sets the attribute and localStorage
key generically.)

- [ ] **Step 5: Run the TypeScript build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds with no TS errors about `currentTheme`,
`applyTheme`, or `initTheme`.

- [ ] **Step 6: Commit**

```bash
git add src/App.vue
git commit -m "refactor: extract Theme type and validated init in App.vue"
```

---

### Task 5: Replace the 2-state toggle with a 4-state cycle + icon/title lookup

**Files:**
- Modify: `src/App.vue:9-16` (template), `:106-131` (script)

**Interfaces:**
- Consumes: `Theme`, `THEME_ORDER`, `currentTheme`, `applyTheme()` from
  Task 4.
- Produces: `cycleTheme()` (replaces `toggleTheme()`), `themeMeta`
  (replaces `isDarkMode`) — a `Record<Theme, { icon: string; title: string }>`
  used by the template for the button's icon and tooltip.

- [ ] **Step 1: Replace the `isDarkMode` computed with a theme metadata map**

Remove line 109:

```ts
const isDarkMode = computed(() => currentTheme.value === 'dark');
```

Add in its place (still inside the `<script setup>` block, near the other
constants):

```ts
const THEME_META: Record<Theme, { icon: string; title: string }> = {
  light: { icon: 'sun', title: 'Light mode' },
  dark: { icon: 'moon', title: 'Dark mode' },
  sepia: { icon: 'coffee', title: 'Sepia mode' },
  earth: { icon: 'droplet', title: 'Earth mode' },
};

const nextThemeMeta = computed(() => {
  const currentIndex = THEME_ORDER.indexOf(currentTheme.value);
  const nextTheme = THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length];
  return THEME_META[nextTheme];
});
```

`nextThemeMeta` drives the button: the icon and tooltip show what clicking
will switch *to* (matching the existing behavior, where the sun/moon icon
represented the mode you'd switch to, not the current mode — e.g. today
`isDarkMode` true shows the sun with title "Light mode", meaning "click to
go light").

- [ ] **Step 2: Replace `toggleTheme()` with `cycleTheme()`**

Replace lines 128-131:

```ts
function toggleTheme(): void {
  currentTheme.value = currentTheme.value === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme.value);
}
```

with:

```ts
function cycleTheme(): void {
  const currentIndex = THEME_ORDER.indexOf(currentTheme.value);
  currentTheme.value = THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length];
  applyTheme(currentTheme.value);
}
```

- [ ] **Step 3: Update the template**

Replace lines 10-16:

```vue
        <button
          @click="toggleTheme"
          class="btn-icon"
          :title="isDarkMode ? 'Light mode' : 'Dark mode'"
        >
          <Icon :name="isDarkMode ? 'sun' : 'moon'" size="18" />
        </button>
```

with:

```vue
        <button
          @click="cycleTheme"
          class="btn-icon"
          :title="nextThemeMeta.title"
        >
          <Icon :name="nextThemeMeta.icon" size="18" />
        </button>
```

- [ ] **Step 4: Run the TypeScript build**

Run: `npm run build`
Expected: build succeeds with no TS/template errors (no references to the
removed `isDarkMode` or `toggleTheme` remain).

Run: `grep -rn "isDarkMode\|toggleTheme" src/`
Expected: no matches (confirms full removal, no stale references in other
files).

- [ ] **Step 5: Commit**

```bash
git add src/App.vue
git commit -m "feat: cycle through 4 themes via toggle button"
```

---

### Task 6: Manual verification pass

**Files:** none (verification only, no code changes).

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Cycle through all four themes**

In the browser, click the theme toggle button 4 times and confirm, at
each step:
- The background, text, accent, border, and panel colors visibly change
  to match the theme (light → dark → sepia → earth → back to light).
- The button's icon changes: sun → moon → coffee → droplet → sun.
- The button's tooltip (hover) shows the *next* theme's name at each
  step (e.g., while on `light`, tooltip reads "Dark mode").

- [ ] **Step 3: Confirm logo inversion**

At each of the 4 themes, confirm `.app-logo` (header) renders correctly:
not inverted on `light`/`sepia`, inverted on `dark`/`earth`.

Open the Help modal (the `?` icon button) and confirm `.about-logo`
matches the same pattern at each of the 4 themes.

- [ ] **Step 4: Confirm persistence**

Select `sepia`, reload the page. Confirm the app comes back up in
`sepia` (not reverting to the OS preference or default). Repeat for
`earth`.

- [ ] **Step 5: Confirm native widget rendering**

On `sepia`, open a `<select>` dropdown (e.g. in ControlPanel or
SettingsModal) and confirm the popup renders with light-appropriate
native styling. On `earth`, confirm it renders with dark-appropriate
native styling (this is driven by the `color-scheme` property set in
Task 1).

- [ ] **Step 6: Confirm `panel-side-bg` themed background**

Confirm the side panels (`.panel-side-bg`, e.g. the left control panel
and right output panel) show a background color at each theme — visually
distinct from the light/dark values (`sepia`/`earth` will show the
defaulted `#ECECEC`/`#2A2A2A` values from Task 2, since no theme-specific
override was given for this call site).

No commit for this task — it's verification only.
