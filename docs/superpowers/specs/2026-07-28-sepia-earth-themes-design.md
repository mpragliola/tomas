# Sepia & Earth themes design

## Summary

Add two new themes, **Sepia** (light) and **Earth** (dark), derived from a
user-supplied warm/earthy palette. The app moves from 2 themes to 4:
existing `light` and `dark` are unchanged; `sepia` and `earth` are new. The
theme toggle changes from a 2-state icon button to a 4-state cycle button.

## Source palette

| Name | Hex |
|---|---|
| Light Bronze | `#cb997e` |
| Desert Sand | `#ddbea9` |
| Almond Cream | `#ffe8d6` |
| Ash Grey | `#b7b7a4` |
| Dry Sage | `#a5a58d` |
| Dusty Olive | `#6b705c` |

## Token mapping

Existing `light` and `dark` theme token blocks in `global.scss` are
unchanged. Two new `data-theme` blocks are added.

| Token | Sepia (light) | Earth (dark) |
|---|---|---|
| `color-scheme` | `light` | `dark` |
| `--color-bg` | `#ffe8d6` (Almond Cream) | `#6b705c` (Dusty Olive) |
| `--color-text-primary` | `#6b705c` (Dusty Olive) | `#ffe8d6` (Almond Cream) |
| `--color-text-secondary` | `#a5a58d` (Dry Sage) | `#ddbea9` (Desert Sand) |
| `--color-accent` | `#cb997e` (Light Bronze) | `#cb997e` (Light Bronze) |
| `--color-spectrum-a` | `#cb997e` (Light Bronze) | `#cb997e` (Light Bronze) |
| `--color-spectrum-b` | `#b7b7a4` (Ash Grey) | `#ddbea9` (Desert Sand) |
| `--color-border` | `#ddbea9` (Desert Sand) | `#a5a58d` (Dry Sage) |
| `--color-modal-bg` | `#ddbea9` (Desert Sand) | `#5a5f4d` (darkened Olive) |
| `--color-modal-header` | `#cb997e` (Light Bronze) | `#7d8268` (darkened Sage) |
| `--color-success` | reuse existing value | reuse existing value |
| `--color-error` | reuse existing value | reuse existing value |
| `--color-warning` | reuse existing value | reuse existing value |

Status colors (success/error/warning) are semantic (green = ok, red =
error) and are not reinterpreted per theme — all four themes reuse the
existing values. The Earth modal tokens (`--color-modal-bg`,
`--color-modal-header`) are derived by darkening Dusty Olive/Dry Sage
since the source palette has no dedicated darker shade for modal
surfaces.

## Architecture changes

### `src/styles/global.scss`

Add `:root[data-theme="sepia"]` and `:root[data-theme="earth"]` blocks
following the existing pattern used by `:root[data-theme="light"]` and
`:root[data-theme="dark"]`, each setting the full variable set from the
mapping table above.

### `src/styles/_mixins.scss`

The `themed($property, $dark, $light)` mixin is binary by signature —
it takes exactly two values and emits overrides for
`prefers-color-scheme` plus explicit `dark`/`light` `data-theme`
selectors. This is restructured to a 4-way mixin:

```scss
@mixin themed($property, $light, $dark, $sepia: $light, $earth: $dark) {
  // base + prefers-color-scheme (light/dark only — sepia/earth are
  // explicit-selection-only, no OS-level equivalent)
  // :root[data-theme="..."] & override per theme, via @each over a
  // theme => value map
}
```

`$sepia` and `$earth` default to `$light` and `$dark` respectively, so
existing call sites that only care about light/dark continue to work
unchanged. Call sites that want theme-specific values (e.g. the logo
filter) pass all four.

Parameter order changes from `($property, $dark, $light)` to
`($property, $light, $dark, ...)` to put the two required params first
and keep the two defaulted params trailing, which is why call sites
need inspection (there is currently one, in `App.vue`).

### `src/components/HelpModal.vue`

Line 272 currently hardcodes a raw `:root[data-theme="light"] &`
selector for `.about-logo`'s `filter` property, bypassing the `themed`
mixin. This is migrated to use the mixin instead:
`@include themed(filter, none, invert(1), $earth: invert(1));` — Sepia
behaves like Light (no invert), Earth behaves like Dark (inverted).

### `src/App.vue`

- Extract `type Theme = 'light' | 'dark' | 'sepia' | 'earth'` as a
  single source of truth, replacing the three separate inlined unions
  (`ref<'light'|'dark'>`, the `localStorage.getItem(...) as`
  assertion, and the `applyTheme` parameter type).
- Add `const THEME_ORDER: Theme[] = ['light', 'dark', 'sepia', 'earth']`.
- Rename `toggleTheme()` to `cycleTheme()`. It finds the current
  theme's index in `THEME_ORDER` and advances to the next one, wrapping
  from the last back to the first.
- `initTheme()` keeps its current logic (localStorage first, else
  `prefers-color-scheme` media query, else default), but the value read
  from localStorage is validated against `THEME_ORDER` before use —
  an invalid or stale stored value falls back to the media-query/default
  path instead of being applied as-is.
- Replace the `isDarkMode` computed and its sun/moon ternary with a
  `Record<Theme, { icon: string; title: string }>` lookup:
  - `light` → `sun`, "Light mode"
  - `dark` → `moon`, "Dark mode"
  - `sepia` → `coffee`, "Sepia mode"
  - `earth` → `droplet`, "Earth mode"
  (Icons confirmed present in the bundled `feather-icons` set.)
- The `.app-logo` filter (`@include themed(filter, invert(1), none)`
  today) is updated to the new 4-arg call, matching the `earth`/`dark`
  invert vs `light`/`sepia` no-invert split used in `HelpModal.vue`.

## Persistence

`localStorage['theme']` continues to store the raw theme string; valid
values become `'light' | 'dark' | 'sepia' | 'earth'`.

## Testing

No existing automated tests cover theming (confirmed — no test files
reference `data-theme`, `theme`, or the toggle). Verification is
manual, in-browser:

- Cycle through all four themes via the toggle button; confirm each
  applies its full variable set (background, text, accent, spectrum,
  borders, modal surfaces).
- Confirm icon and tooltip update correctly at each step of the cycle.
- Reload the page after selecting each theme; confirm the choice
  persists via `localStorage`.
- Confirm `.app-logo` (App.vue) and `.about-logo` (HelpModal.vue)
  filters render correctly (inverted for dark/earth, not inverted for
  light/sepia) in all four themes.
- Confirm `color-scheme` switches native widgets (scrollbars, select
  popups) appropriately for light-character (light, sepia) vs
  dark-character (dark, earth) themes.

## Out of scope

- No changes to `--color-success`, `--color-error`, `--color-warning`
  values — these stay semantic and constant across all four themes.
- No dropdown/menu theme picker — the toggle remains a single button,
  now cycling through 4 states instead of 2.
- No changes to the existing `light`/`dark` token values.
