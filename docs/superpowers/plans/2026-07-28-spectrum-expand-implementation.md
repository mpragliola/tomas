# Spectrum Expand Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an expand/collapse button to the Frequency Spectrum header that maximizes the spectrum visualization by hiding the waves panel and left sidebar, with smooth animations and localStorage persistence.

**Architecture:** The expanded state lives in `App.vue` as a reactive ref synced to localStorage. When toggled, CSS classes on `.panel-waves` and `.panel-input` trigger simultaneous fade/slide animations while `.panel-spectrum` scales to fill the space. The button in `SpectrumViewer.vue` emits an event that `App.vue` listens to for toggling the state.

**Tech Stack:** Vue 3 (Composition API), TypeScript, SCSS with CSS transitions, localStorage API, Feather Icons (existing Icon component)

## Global Constraints

- Expand state defaults to `false` (minimized on first load)
- Persist to localStorage key `spectrum-expanded`
- All animations run simultaneously with 300ms `ease-out` timing
- Right sidebar (`.panel-output`) must never be hidden or affected
- Icon set: `maximize-2` (minimized) and `minimize-2` (expanded), from existing Feather icon set

---

## Task 1: Add expand/collapse state to App.vue

**Files:**
- Modify: `src/App.vue:86-113` (script setup section)

**Interfaces:**
- Produces: `isSpectrumExpanded` ref (boolean), `toggleSpectrumExpand()` function that syncs to localStorage
- Consumed by: SpectrumViewer via props/events in Task 2

**Steps:**

- [ ] **Step 1: Add expand state ref and localStorage sync**

In the `<script setup>` section of `App.vue`, after line 105 (after `computingStep` ref), add:

```typescript
const isSpectrumExpanded = ref(false);

function loadSpectrumExpandState(): void {
  const saved = localStorage.getItem('spectrum-expanded');
  if (saved !== null) {
    isSpectrumExpanded.value = saved === 'true';
  }
}

function saveSpectrumExpandState(): void {
  localStorage.setItem('spectrum-expanded', String(isSpectrumExpanded.value));
}

function toggleSpectrumExpand(): void {
  isSpectrumExpanded.value = !isSpectrumExpanded.value;
  saveSpectrumExpandState();
}
```

- [ ] **Step 2: Load stored state on mount**

Modify the `onMounted` hook (line 111-114) to call the load function:

```typescript
onMounted(() => {
  logger.info('App', 'Application mounted');
  initTheme();
  loadSpectrumExpandState();
});
```

- [ ] **Step 3: Run tests to verify state loads/saves correctly**

Run: `npm run test:unit` (or your test command)
Expected: No errors in App.vue tests; state loads from and saves to localStorage

- [ ] **Step 4: Commit**

```bash
git add src/App.vue
git commit -m "feat: add spectrum expand state management with localStorage persistence"
```

---

## Task 2: Add expand button to SpectrumViewer header

**Files:**
- Modify: `src/components/SpectrumViewer.vue:1-25` (template and script setup)

**Interfaces:**
- Consumes: `isSpectrumExpanded` (boolean prop), `onToggleExpand` (function prop) passed from App.vue
- Produces: Button that calls `onToggleExpand()` when clicked

**Steps:**

- [ ] **Step 1: Modify template to add expand button**

Replace the `.spectrum-header` div (lines 3-5) with:

```vue
<div class="spectrum-header">
  <h3 class="spectrum-title">Frequency Spectrum</h3>
  <button
    class="btn-expand"
    :title="isSpectrumExpanded ? 'Collapse' : 'Expand'"
    @click="onToggleExpand"
  >
    <Icon :name="isSpectrumExpanded ? 'minimize-2' : 'maximize-2'" size="18" />
  </button>
</div>
```

- [ ] **Step 2: Add props to script setup**

Add after line 33 (after the `const store` line):

```typescript
interface Props {
  isSpectrumExpanded: boolean;
}

interface Emits {
  (e: 'toggle-expand'): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

function onToggleExpand(): void {
  emit('toggle-expand');
}
```

- [ ] **Step 3: Add button styles**

Add to the `<style scoped>` section (after line 93, inside the `spectrum-header` rules):

```scss
.btn-expand {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: all 200ms ease-out;

  &:hover {
    background-color: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  &:active {
    transform: scale(0.95);
  }
}
```

- [ ] **Step 4: Verify button renders with correct icon**

Run dev server: `npm run dev`
Navigate to app, check spectrum header
Expected: Button with `maximize-2` icon appears on the right side of "Frequency Spectrum" title

- [ ] **Step 5: Commit**

```bash
git add src/components/SpectrumViewer.vue
git commit -m "feat: add expand button to spectrum header with toggle icon"
```

---

## Task 3: Wire up expand button to App.vue state

**Files:**
- Modify: `src/App.vue:43-62` (template main section)

**Interfaces:**
- Consumes: `isSpectrumExpanded` and `toggleSpectrumExpand()` from Task 1
- Produces: SpectrumViewer bound to props/events

**Steps:**

- [ ] **Step 1: Pass state and handler to SpectrumViewer**

Modify the SpectrumViewer component tag (line 59) to:

```vue
<SpectrumViewer 
  :is-spectrum-expanded="isSpectrumExpanded"
  @toggle-expand="toggleSpectrumExpand"
/>
```

- [ ] **Step 2: Verify wiring works**

Run dev server and click the expand button
Expected: Button icon toggles between `maximize-2` and `minimize-2`, state persists across reloads

- [ ] **Step 3: Commit**

```bash
git add src/App.vue
git commit -m "feat: wire spectrum expand button to App state"
```

---

## Task 4: Add CSS animations for smooth transitions

**Files:**
- Modify: `src/App.vue:280-345` (styles scoped section)

**Interfaces:**
- Consumes: `isSpectrumExpanded` reactive ref from Task 1
- Produces: CSS classes and animations for `.panel-waves` and `.panel-input`

**Steps:**

- [ ] **Step 1: Add transition utilities and animation keyframes**

Add to the scoped `<style>` section in App.vue (before the closing `</style>` tag, around line 345):

```scss
// Transition utilities for expand/collapse animations
.panel-waves,
.panel-input {
  transition: opacity 300ms ease-out, transform 300ms ease-out;
}

// Expand mode: hide waves and sidebar
.spectrum-expanded {
  .panel-waves {
    opacity: 0;
    transform: translateY(-20px);
    pointer-events: none;
    height: 0;
    overflow: hidden;
    padding: 0;
  }

  .panel-input {
    opacity: 0;
    transform: translateX(-20px);
    pointer-events: none;
    width: 0;
    overflow: hidden;
    padding: 0;
  }

  .panel-spectrum {
    transition: flex 300ms ease-out;
  }
}

// Minimized mode (default): waves and sidebar visible
.spectrum-minimized {
  .panel-waves {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  .panel-input {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
  }
}
```

- [ ] **Step 2: Bind expand state to .main-left class**

Modify the `.main-left` div (line 44) to:

```vue
<div class="main-left" :class="isSpectrumExpanded ? 'spectrum-expanded' : 'spectrum-minimized'">
```

- [ ] **Step 3: Adjust .main-lower for smooth spectrum growth**

Modify the `.main-lower` flex styling in the scoped styles section (around line 306-312) to ensure it grows smoothly:

The existing styles already support this, but verify that `.main-lower` has `flex: 1` and `gap: 12px`.

- [ ] **Step 4: Test animations in browser**

Run dev server and click expand button multiple times
Expected: 
- Waves panel fades out and slides up
- Left sidebar fades out and slides left
- Spectrum smoothly grows to fill the space
- All animations take ~300ms
- Return to minimized state reverses all animations smoothly

- [ ] **Step 5: Verify animation performance**

Open browser DevTools (Performance tab)
Expected: No jank, consistent 60fps during animations

- [ ] **Step 6: Commit**

```bash
git add src/App.vue
git commit -m "feat: add smooth fade/slide animations for spectrum expand/collapse"
```

---

## Task 5: Ensure right sidebar stays unaffected and test edge cases

**Files:**
- Modify: None (verification task)
- Test: Manual testing of layout and interactions

**Interfaces:**
- Verifies: `.panel-output` (right sidebar) is never hidden; interaction with IR and Playback controls

**Steps:**

- [ ] **Step 1: Test right sidebar visibility in both states**

Run dev server
- Minimize spectrum (default state): Verify `.panel-output` (IR & Playback) is visible
- Expand spectrum: Verify `.panel-output` stays visible and unaffected
Expected: Right sidebar always visible, no opacity/transform changes

- [ ] **Step 2: Test right sidebar interaction while expanded**

With spectrum expanded:
- Click playback button → audio should play
- Interact with IR display controls → should respond normally
Expected: All right sidebar controls work in both states

- [ ] **Step 3: Test state persistence across page reload**

- [ ] Expand spectrum
- [ ] Reload page (F5 or Cmd+R)
- [ ] Check if spectrum stays expanded
Expected: Spectrum stays expanded after reload

- [ ] Collapse spectrum
- [ ] Reload page
- [ ] Check if spectrum stays minimized
Expected: Spectrum stays minimized after reload

- [ ] **Step 4: Test animation cleanup on rapid toggles**

Rapidly click expand/collapse button 5-10 times
Expected: Animations complete smoothly, no stuck states, no visual glitches

- [ ] **Step 5: Test with very small viewport**

Resize browser window to very narrow width
Expected: Spectrum still expands to fill available space; right sidebar may be squeezed but doesn't disappear

- [ ] **Step 6: Test prefers-reduced-motion**

In browser DevTools, enable "Prefers reduced motion"
Click expand button
Expected: State changes instantly or with very fast transition (no animation)

**Note:** If `prefers-reduced-motion` is not currently handled, add to App.vue styles:

```scss
@media (prefers-reduced-motion: reduce) {
  .panel-waves,
  .panel-input,
  .panel-spectrum {
    transition: none !important;
  }
}
```

- [ ] **Step 7: Document any issues found**

If any issues found, note them for follow-up task

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test: verify spectrum expand/collapse behavior across edge cases"
```

---

## Task 6: Add accessibility enhancements

**Files:**
- Modify: `src/components/SpectrumViewer.vue:30-48` (script and button styles)

**Interfaces:**
- Consumes: Existing button structure from Task 2
- Produces: Enhanced accessibility attributes

**Steps:**

- [ ] **Step 1: Add ARIA attributes to expand button**

Modify the button in SpectrumViewer template (from Task 2) to include:

```vue
<button
  class="btn-expand"
  :title="isSpectrumExpanded ? 'Collapse spectrum' : 'Expand spectrum'"
  :aria-label="isSpectrumExpanded ? 'Collapse spectrum viewer' : 'Expand spectrum viewer'"
  :aria-pressed="isSpectrumExpanded"
  @click="onToggleExpand"
>
  <Icon :name="isSpectrumExpanded ? 'minimize-2' : 'maximize-2'" size="18" />
</button>
```

- [ ] **Step 2: Verify keyboard accessibility**

Run dev server
- Tab to expand button (should be focusable)
- Press Enter or Space → spectrum should expand/collapse
- Check focus outline is visible
Expected: Button is fully keyboard accessible with visible focus indicator

- [ ] **Step 3: Test with screen reader (optional)**

If possible, test with browser screen reader
Expected: Button purpose is clear from aria-label and aria-pressed

- [ ] **Step 4: Commit**

```bash
git add src/components/SpectrumViewer.vue
git commit -m "feat: add accessibility attributes to expand button"
```

---

## Summary

This implementation plan covers:

1. **State Management** (Task 1): Add `isSpectrumExpanded` ref to App.vue with localStorage persistence
2. **Button UI** (Task 2): Add expand/collapse button to SpectrumViewer header with dynamic icon
3. **Wiring** (Task 3): Connect button to App state via props/events
4. **Animations** (Task 4): CSS transitions for fade/slide effects on waves and sidebar, scale on spectrum
5. **Testing** (Task 5): Comprehensive edge case and interaction testing
6. **Accessibility** (Task 6): ARIA attributes and keyboard navigation support

All animations are coordinated (300ms, ease-out) and simultaneous. The right sidebar is never affected. State persists via localStorage and restores on page reload.

