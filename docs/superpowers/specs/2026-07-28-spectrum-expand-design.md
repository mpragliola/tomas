# Frequency Spectrum Expand Button — Design Spec

**Date:** 2026-07-28  
**Status:** Approved

---

## Overview

Add an expand/collapse toggle button to the Frequency Spectrum widget header that allows users to maximize the spectrum visualization to fill the center area. When expanded, the waves panel and left sidebar fade out while the spectrum grows to fill available space, leaving only the right sidebar (IR & Playback) visible. The expanded state persists via localStorage.

---

## User Intent & Success Criteria

**Why:** Users analyzing spectral data need more screen real estate for detailed visualization without losing access to playback controls.

**Success Criteria:**
- Expand button clearly visible in spectrum header
- Smooth, coordinated animation when toggling states
- Left sidebar and waves panel disappear when expanded
- Right sidebar (IR & Playback) remains always visible and unaffected
- Expanded state remembered across page reloads

---

## Layout States

### Minimized (Default Startup State)

```
┌─────────────────────────────────────────────────────┐
│                    App Header                        │
├──────────────────┬──────────────────┬────────────────┤
│                  │                  │  Right Sidebar │
│  Waves Panel     │  Waves Panel     │  (IR & Play)   │
│  (spanning)      │  (spanning)      │                │
├──────────────────┼──────────────────┤                │
│                  │                  │                │
│  Left Sidebar    │  Spectrum        │                │
│  (Controls,      │  Viewer          │                │
│   Recording)     │  (main focus)    │                │
│                  │                  │                │
└──────────────────┴──────────────────┴────────────────┘
```

**Visible elements:**
- Waves panel at top (`.panel-waves`)
- Left sidebar (`.panel-input`) with controls and recording
- Spectrum viewer (`.panel-spectrum`) in center
- Right sidebar (`.panel-output`) with IR display and playback

---

### Expanded State

```
┌─────────────────────────────────────────────────────┐
│                    App Header                        │
├─────────────────────────────────────┬────────────────┤
│                                     │  Right Sidebar │
│                                     │  (IR & Play)   │
│          Spectrum Viewer            │                │
│          (fullscreen center)        │                │
│                                     │                │
│                                     │                │
└─────────────────────────────────────┴────────────────┘
```

**Visible elements:**
- Spectrum viewer fills entire center area (full `.main-left` width and height)
- Right sidebar (`.panel-output`) stays unchanged
- Waves panel and left sidebar are hidden

---

## Header & Controls

### Spectrum Header Layout

Modify `.spectrum-header` to flex with space-between alignment:
- **Left section:** Title "Frequency Spectrum"
- **Right section:** Expand/Collapse button (icon-only)

**Button specs:**
- Icon when minimized: `maximize-2` (expand symbol)
- Icon when expanded: `minimize-2` (collapse symbol)
- Style: Consistent with existing header icon buttons (`.btn-icon`)
- Tooltip: "Expand" / "Collapse"
- No text label, icon only

---

## Animation & Transitions

**Trigger:** User clicks expand/collapse button

**Coordinated animations (all simultaneous, 300ms duration, `ease-out` timing):**

| Element | Minimized → Expanded | Expanded → Minimized |
|---------|----------------------|----------------------|
| **Waves Panel** | Fade out + Slide up | Fade in + Slide down |
| **Left Sidebar** | Fade out | Fade in |
| **Spectrum** | Scale/grow to fill space | Scale down to original size |
| **Right Sidebar** | No change | No change |

**CSS properties animated:**
- Opacity for fade effects
- Transform for slide and scale
- All elements use the same 300ms `ease-out` curve for visual unity

---

## State Management

### Reactive State
- Variable: `isSpectrumExpanded` (boolean ref in App.vue or SpectrumViewer.vue)
- Default: `false` (minimized on first load)

### Persistence
- **Storage key:** `spectrum-expanded`
- **Mechanism:** localStorage
- **Timing:**
  - Read on component mount to restore user preference
  - Write on every toggle to keep in sync
- **Fallback:** If localStorage is unavailable, default to minimized

### Toggle Behavior
```
User clicks button
  ↓
Toggle isSpectrumExpanded
  ↓
Update localStorage
  ↓
CSS classes/bindings react to state change
  ↓
Animations play simultaneously
  ↓
New layout renders
```

---

## Implementation Details

### File Changes

**1. SpectrumViewer.vue**
- Add expand button to `.spectrum-header`
- Import expand/collapse icons
- Track `isSpectrumExpanded` state (or accept as prop from parent)
- Emit event or update global state on button click
- Update header template to show appropriate icon

**2. App.vue**
- Add `isSpectrumExpanded` reactive state
- Load from localStorage on mount
- Conditionally apply visibility/display CSS classes to `.panel-waves` and `.panel-input`
- Bind state to SpectrumViewer for bidirectional sync (or use Pinia store)
- Update localStorage on state change

**3. Global styles (App.vue scoped styles)**
- Add transition classes for `.panel-waves`, `.panel-input`, and `.main-lower`
- Define keyframes for fade, slide, and scale animations
- Ensure 300ms duration and `ease-out` timing function

### CSS Architecture

**Transition utilities:**
```scss
.spectrum-expand-transition {
  transition: opacity 300ms ease-out, transform 300ms ease-out;
}

// State-based classes
.waves-visible { opacity: 1; transform: translateY(0); }
.waves-hidden { opacity: 0; transform: translateY(-20px); }

.sidebar-visible { opacity: 1; }
.sidebar-hidden { opacity: 0; }
```

**Layout adjustments:**
- When expanded, `.panel-waves` and `.panel-input` are `display: none` or `visibility: hidden` (after animation completes)
- `.panel-spectrum` inherits full width of `.main-lower`
- `.main-left` preserves gap and flex properties during animation

---

## Icon Choices

- **Minimized state button:** `maximize-2` (expand outward arrows)
- **Expanded state button:** `minimize-2` (collapse inward arrows)
- Both from existing Icon.vue component library (Feather icons)

---

## Browser & Accessibility

- State persists across tabs/windows via localStorage
- Icon buttons include `title` attribute for tooltip
- Keyboard accessible (standard button)
- Smooth animations respect `prefers-reduced-motion` if media query is implemented

---

## Edge Cases & Considerations

1. **Expand while computing spectra:** Button remains clickable; layout changes regardless of computation state.
2. **Very narrow viewport:** Spectrum still expands to fill available center area (right sidebar may wrap if screen is very small).
3. **localStorage unavailable:** Default to minimized on each page load.
4. **Multiple tabs:** Each tab has independent localStorage, so expanding in one tab doesn't affect others.

---

## Testing Checklist

- [ ] Button appears in spectrum header with correct icon
- [ ] Click expand: waves/sidebar fade+slide out, spectrum grows
- [ ] Click collapse: waves/sidebar fade+slide in, spectrum shrinks
- [ ] Expanded state saved to localStorage
- [ ] Page reload preserves expanded state
- [ ] Right sidebar remains visible and functional in both states
- [ ] Animations complete in ~300ms
- [ ] No layout shifts or jank during transition
- [ ] Tooltip text appears on hover
- [ ] Keyboard navigation works (Tab to button, Enter/Space to toggle)

