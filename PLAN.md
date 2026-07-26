# Audio Spectrum & Impulse Response Matcher - Implementation Plan

## Architecture Overview

Application performs audio analysis and tone-matching via impulse response derivation. Separates **algorithmic layers** (testable in isolation) from **UI layers** (visual confirmation).

```
User Upload (WAV files)
      ↓
   WAV Parser → Extract PCM audio buffers
      ↓
FFT Processor → Compute magnitude spectra (A, B)
      ↓
Spectrum Difference → Derive IR coefficients
      ↓
Visualization Layer → Display spectra + IR result
```

---

## Project Structure

```
tomas/
├── src/
│   ├── components/
│   │   ├── FileUpload.vue               # Dual WAV file picker
│   │   ├── SpectrumViewer.vue           # Visualization of freq spectra
│   │   ├── ImpulseResponseDisplay.vue   # IR visualization & export
│   │   ├── ControlPanel.vue             # FFT params, analysis controls
│   │   └── App.vue                      # Main layout orchestrator
│   │
│   ├── services/
│   │   ├── audio/
│   │   │   ├── wavParser.ts             # WAV file → PCM buffer extraction
│   │   │   ├── fftProcessor.ts          # FFT computation wrapper
│   │   │   └── audioUtils.ts            # Resampling, windowing (Hann, etc)
│   │   │
│   │   └── dsp/
│   │       ├── spectrum.ts              # Magnitude/phase spectrum extraction
│   │       ├── irDerivation.ts          # IR from spectrum difference
│   │       └── convolution.ts           # (Optional) Apply IR to signal
│   │
│   ├── types/
│   │   ├── audio.ts                     # AudioBuffer, WavHeader interfaces
│   │   ├── spectrum.ts                  # FrequencySpectrum, SpectrumConfig
│   │   └── ir.ts                        # ImpulseResponse, IROptions
│   │
│   ├── utils/
│   │   ├── mathUtils.ts                 # Math helpers (log, dB conversion, etc)
│   │   ├── fileUtils.ts                 # ArrayBuffer handling
│   │   └── visualization.ts             # Color mapping, scale transforms
│   │
│   ├── stores/
│   │   └── analysisStore.ts             # Pinia store for loaded files, computed spectra
│   │
│   ├── main.ts
│   └── App.vue
│
├── tests/
│   ├── unit/
│   │   ├── services/
│   │   │   ├── wavParser.test.ts
│   │   │   ├── fftProcessor.test.ts
│   │   │   ├── spectrum.test.ts
│   │   │   └── irDerivation.test.ts
│   │   └── utils/
│   │       └── mathUtils.test.ts
│   │
│   ├── integration/
│   │   └── pipeline.test.ts             # WAV → Spectrum → IR workflow
│   │
│   └── fixtures/
│       ├── sample-sine-440hz.wav
│       └── sample-sine-880hz.wav
│
├── public/
│   └── index.html
│
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
├── .env.example                 # Template (checked in)
├── .env                         # Local overrides (git-ignored)
├── .gitignore
├── package.json
└── README.md
```

---

## Core Modules

### 1. WAV Parser (`src/services/audio/wavParser.ts`)

Parse WAV files (RIFF structure) → Extract PCM audio data.

**Interface**:
```typescript
interface WavHeader {
  sampleRate: number;
  channels: number;
  bitDepth: 16 | 24 | 32;
  duration: number;
}

async function parseWavFile(file: File): Promise<{
  header: WavHeader;
  audioData: Float32Array;  // Normalized to [-1, 1]
}>
```

**Responsibilities**:
- Handle RIFF/WAV format correctly (RIFF header, fmt subchunk, data subchunk)
- Convert PCM (int16/24/32) to Float32Array
- Handle mono & stereo (mix stereo to mono)
- Validate file integrity

**Why algorithmic**: Pure parsing logic; testable with mock WAV buffers.

---

### 2. FFT Processor (`src/services/audio/fftProcessor.ts`)

Compute frequency-domain representation (magnitude spectrum).

**Dependency**: Use `fft.js` library (battle-tested, ~12KB). Web Audio API `AnalyserNode` lacks phase info needed for IR derivation.

**Interface**:
```typescript
interface FFTConfig {
  fftSize: 512 | 1024 | 2048 | 4096 | 8192 | 16384;
  window: 'hann' | 'hamming' | 'rectangular';
  overlap: 0.5 | 0.75;  // For multi-frame averaging
}

function computeFFT(
  signal: Float32Array,
  config: FFTConfig
): {
  magnitudes: Float32Array;      // Linear magnitude [0, ∞)
  phases: Float32Array;          // Radians [-π, π]
  frequencies: Float32Array;     // Hz
}
```

**Responsibilities**:
- Apply windowing function (Hann for general purpose)
- Handle edge cases (zero-padding, normalization)
- Multi-frame averaging for non-stationary signals (optional)

---

### 3. Spectrum Extractor (`src/services/dsp/spectrum.ts`)

Convert FFT output → visualization-ready spectrum (magnitude in dB).

**Interface**:
```typescript
interface FrequencySpectrum {
  frequencies: Float32Array;     // Hz
  magnitudesLinear: Float32Array; // [0, ∞)
  magnitudesDb: Float32Array;    // dB (20*log10)
  phase: Float32Array;           // radians
}

function extractSpectrum(
  fftResult: { magnitudes, phases, frequencies },
  refLevel: number = 1.0  // dB reference (1.0 = 0dB)
): FrequencySpectrum
```

**Responsibilities**:
- Convert linear magnitude to dB scale (20*log10(mag/ref))
- Handle magnitude = 0 (clamp to avoid log(0))
- Provide both linear and dB for flexibility

---

### 4. Impulse Response Derivation (`src/services/dsp/irDerivation.ts`)

Core DSP algorithm — derive IR from spectrum difference.

**Algorithm**:
```
1. Load Spectrum A (desired) and Spectrum B (current)
2. Compute difference: Delta(f) = Magnitude_A(f) - Magnitude_B(f)
   OR ratio: Ratio(f) = Magnitude_A(f) / Magnitude_B(f)
3. Create IR in frequency domain:
   - Preserve phase of B (or use minimum phase from magnitude)
   - Assign magnitude = Delta(f) [or log(Ratio)]
4. IFFT → time-domain impulse response
5. Window & truncate to practical length (100-1000ms)
```

**Interface**:
```typescript
interface ImpulseResponse {
  coefficients: Float32Array;    // Time-domain IR
  length: number;                // Samples
  sampleRate: number;
}

interface IRDerivationConfig {
  method: 'difference' | 'ratio';       // Magnitude relationship
  phase: 'preserve-B' | 'minimum-phase'; // Phase strategy
  maxLength: number;                     // Max IR length (samples)
  truncationDb: number;                  // Energy threshold for truncation
}

function deriveIR(
  spectrumA: FrequencySpectrum,
  spectrumB: FrequencySpectrum,
  config: IRDerivationConfig
): ImpulseResponse
```

**Responsibilities**:
- Phase handling (preserve phase of B is simpler than minimum-phase)
- Magnitude clipping (avoid extremely large/small values)
- Truncation (practical IRs are finite; truncate by energy threshold)
- Reconstruction (IFFT to convert back to time domain)

---

### 5. Audio Recorder (`src/services/audio/recorder.ts`)

Record audio from microphone (getUserMedia) with level-threshold triggering.

**Interface**:
```typescript
interface RecorderConfig {
  sampleRate: 44100 | 48000;
  maxDuration: number;        // Milliseconds (max 20s = 20000)
  channelCount: 1 | 2;        // Mono or stereo
  autoThreshold: number;      // dB below silence floor (-40dB typical)
}

interface RecorderState {
  isRecording: boolean;
  isPaused: boolean;
  recordedDuration: number;   // ms
  level: number;              // Current dB level
}

class AudioRecorder {
  async start(config: RecorderConfig): Promise<void>
  async stop(): Promise<Float32Array>  // Returns recorded audio
  pause(): void
  resume(): void
  getRecordedDuration(): number
  getCurrentLevel(): number    // For real-time level display
}
```

**Responsibilities**:
- Stream from getUserMedia (microphone)
- Circular buffer (max 20s; oldest data discarded)
- Level detection (RMS-based dB calculation)
- Auto-trigger: Record starts when level exceeds threshold, stops after silence (>1s below threshold)
- Manual start/stop buttons
- Handle permissions (browser prompt)

**Why algorithmic**: Level detection is pure DSP; testable with synthetic audio streams.

---

### 6. Playback & Convolution (`src/services/audio/convolution.ts`)

Apply derived IR to audio signal via convolution or frequency-domain multiplication.

**Interface**:
```typescript
interface PlaybackConfig {
  irCoefficients: Float32Array;
  audioData: Float32Array;
  sampleRate: number;
}

function convolveAudio(config: PlaybackConfig): Float32Array
```

**Responsibilities**:
- Time-domain convolution (naive) OR frequency-domain (FFT-based, faster)
- Output normalization to prevent clipping
- Efficient buffering for playback

---

### 7. Waveform Renderer & Selector

Interactive waveform display with zoom, pan, and region selection for partial tone-matching.

**Key features**:
- Canvas-based waveform rendering (fast, responsive)
- Zoom in/out (mouse wheel, buttons)
- Pan (drag horizontal)
- Draw selection box OR drag selection borders (left/right handles)
- Display selected time range (ms or samples)
- Update IR computation to use only selected region

**Dependency**: Use `wavesurfer.js` (interactive waveform, ~50KB with plugins) OR build custom Canvas renderer.
- **Recommendation**: **wavesurfer.js** with selection plugin for MVP; custom if performance critical

---

### 9. Logging Service (`src/services/logging.ts`)

Centralized logging with debug mode and configurable verbosity.

**Interface**:
```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: number
  level: LogLevel
  source: string    // Component/service name
  message: string
  data?: any        // Structured data
}

class Logger {
  setDebugMode(enabled: boolean): void
  setLevel(level: LogLevel): void
  debug(source: string, message: string, data?: any): void
  info(source: string, message: string, data?: any): void
  warn(source: string, message: string, data?: any): void
  error(source: string, message: string, data?: any): void
  getHistory(): LogEntry[]
  clear(): void
  exportLog(): string  // JSON format for download
}
```

**Responsibilities**:
- Collect logs from all services/components
- Filter by level when debug mode off
- Store in circular buffer (last 1000 entries)
- Provide export for bug reports
- Console output in dev mode

---

### 10. Debug Panel (`src/components/DebugPanel.vue`)

Display logs in real-time when debug mode enabled.

**Features**:
- Toggle button (debug on/off)
- Log level filter (show: debug/info/warn/error)
- Live log feed (scrollable, newest at bottom)
- Search/grep logs by source or message
- Clear logs button
- Export logs button (JSON download)
- Expandable structured data (click to expand objects)

### 11. Vue Components

**FileUpload.vue**: Dual file input (WAV 1 + WAV 2) + drag-and-drop + validation

**RecordingPanel.vue** (NEW):
- Record button (manual start/stop)
- Real-time level meter (dB display, visual bar)
- Recording duration (0-20s counter)
- Auto-trigger checkbox + threshold slider (-60dB to -20dB)
- Status: idle/recording/paused
- Save button (convert to WAV, store in audioBuffers.A)
- Alternative to FileUpload for WAV 1 only

**WaveformViewer.vue** (NEW): 
- Display waveform for file A + file B
- Zoom/pan controls
- Selection region (draw or drag borders)
- Show selected time range
- Emits: `@selectionChanged="{ start, end, samples }"`

**SpectrumViewer.vue**: Dual-plot (spectrum A vs B), linear/log scale toggle, dB range selector, hover tooltips. Use **Plotly.js** for interactive scientific plotting.

**ImpulseResponseDisplay.vue**: Time-domain IR waveform, metadata, export button (WAV + JSON), **Play button** (apply IR + playback)

**PlaybackPanel.vue** (NEW):
- Play button (start/stop)
- Volume slider
- Progress bar + current time display
- Status: playing/stopped

**DebugPanel.vue** (NEW):
- Toggle button (debug mode on/off)
- Log level filter
- Live log feed (scrollable)
- Search logs
- Clear/export buttons
- Expandable structured data

**ControlPanel.vue**: FFT parameters (size, window), IR derivation method, analysis trigger

**App.vue**: Main layout, state orchestration, DebugPanel drawer

---

## Data Flow

```
┌─ FileUpload.vue (WAV 1 & 2)
│       ↓
├─ RecordingPanel.vue (WAV 1 alternative)
│   │ getUserMedia → recorder.ts → circular buffer (max 20s)
│   └→ save → audioBuffers.A
│
└───────→ analysisStore (Pinia)
  - audioBuffers: { A: Float32Array, B: Float32Array }
  - selections: { A: {start, end, samples}, B: {start, end, samples} }
  - spectra: { A: FrequencySpectrum, B: FrequencySpectrum }
  - ir: ImpulseResponse
  - convolved: Float32Array  (A with IR applied)
        ↓
    ┌───────────────────┬─────────────┬─────────────────┐
    ↓                   ↓             ↓                 ↓
WaveformViewer.vue  SpectrumViewer   ImpulseResponse   PlaybackPanel.vue
(A & B waveforms)   (A vs B plots)   Display.vue       (play convolved A)
  └→ selection        (truncated to  └→ Play button
     region           selections)       →convolution.ts
                                        →Web Audio API
```

**Store Structure**:
```typescript
interface AnalysisState {
  audioBuffers: { A: Float32Array, B: Float32Array }
  selections: {
    A: { startSample: number, endSample: number, duration: number }
    B: { startSample: number, endSample: number, duration: number }
  }
  spectra: { A: FrequencySpectrum, B: FrequencySpectrum }
  ir: ImpulseResponse
  convolved: Float32Array  // A with IR applied
  playbackState: 'idle' | 'playing' | 'paused'
  recordingState: 'idle' | 'recording' | 'paused'
}
```

**Store Actions**:
```typescript
async loadFile(file: File, slot: 'A' | 'B')
async recordAudio(config: RecorderConfig)  // Start recording from mic
async stopRecording()  // Save to audioBuffers.A
updateSelection(slot: 'A' | 'B', startSample: number, endSample: number)
async computeSpectra(config: FFTConfig)  // Uses selected regions of A and B
async computeIR(config: IRDerivationConfig)
async applyIR()  // Convolve A with IR, store in convolved
async playback(volume: number)  // Web Audio API playback
async stopPlayback()
```

---

## Testing Strategy

### Unit Tests (Algorithmic modules)

**wavParser.test.ts**: Parse WAV → correct header/audio, handle bit depths, stereo→mono, invalid headers

**fftProcessor.test.ts**: Sine peak detection, windowing spectral leakage, Parseval's theorem

**spectrum.test.ts**: Linear/dB conversion formulas, reference level handling

**irDerivation.test.ts**: Flat A + peaked B → inverse peak in IR, energy conservation, truncation, parametric sweep

**mathUtils.test.ts**: dB conversion, frequency warping

### Integration Tests

**pipeline.test.ts**: WAV → FFT → verify peak, 2 WAVs → IR → energy check, end-to-end WAV→spectrum→IR→export→reimport

### E2E Tests

Playwright: Upload files, verify plots, trigger IR, verify display, download/reimport

**Test Fixtures**:
- sample-sine-440hz.wav (1s, mono, 44.1kHz)
- sample-sine-880hz.wav (1s, mono, 44.1kHz)

---

## Dependencies

```json
{
  "dependencies": {
    "vue": "^3.3.0",
    "pinia": "^2.1.0",
    "plotly.js": "^2.26.0",
    "fft.js": "^4.0.3",
    "wavesurfer.js": "^7.0.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "vitest": "^1.0.0",
    "typescript": "^5.3.0",
    "@vitejs/plugin-vue": "^5.0.0",
    "@vitest/ui": "^1.0.0",
    "vue-tsc": "^1.8.0"
  }
}
```

**Environment & Debug**:
- `.env.example` — Template with all available vars (check into repo)
- `.env` — Local overrides (git-ignored)
- `VITE_DEBUG_MODE=true|false` — Enable debug logging on startup (default: false)
- `VITE_LOG_LEVEL=debug|info|warn|error` — Set initial log level (default: info)
- `VITE_MAX_RECORDING_DURATION=20000` — Max recording length in ms (default: 20000)
- `VITE_LEVEL_THRESHOLD_DB=-40` — Default auto-trigger threshold in dB (default: -40)
- Runtime toggle: DebugPanel.vue or keyboard shortcut (Ctrl+Shift+D)

**vite.config.ts**:
- Use `import.meta.env.VITE_*` to access vars
- Ensure `.env.example` is tracked; `.env` is `.gitignore`d

**loggers.ts**:
```typescript
const DEBUG_MODE = import.meta.env.VITE_DEBUG_MODE === 'true'
const LOG_LEVEL = import.meta.env.VITE_LOG_LEVEL || 'info'
logger.setDebugMode(DEBUG_MODE)
logger.setLevel(LOG_LEVEL)
```

**Waveform rendering**:
- **wavesurfer.js** (recommended): Interactive waveform, zoom, selection plugin, ~50KB. Use for MVP.
- **Custom Canvas**: Build renderer if performance critical (rare).

**Spectrum viz**: Plotly.js (~3MB); Chart.js (~60KB) if bandwidth critical.

---

## Implementation Order

### Phase 1: Core DSP Pipeline & Logging (Weeks 1-2)

1. Vite + TypeScript + Vue + Pinia setup
2. Create `.env.example` + `.env` (git-ignored) with defaults
3. Create types (audio.ts, spectrum.ts, ir.ts)
4. logging.ts + logger setup (read env vars, globally available)
4. wavParser.ts + unit tests (log all parsing steps)
5. fftProcessor.ts + unit tests (fft.js, log FFT params)
6. spectrum.ts + tests
7. irDerivation.ts + tests (core algorithm, log derivation steps)
8. recorder.ts + unit tests (log recording state, level)
9. convolution.ts + tests
10. analysisStore.ts with basic actions (log state changes)
11. **Unblocked**: Data transformation pipeline + logging complete

### Phase 2: UI Foundation (Weeks 2-3)

12. FileUpload.vue (file picker + validation, log file load)
13. RecordingPanel.vue (getUserMedia, recorder.ts integration, log recording)
14. WaveformViewer.vue (wavesurfer.js integration, zoom, pan, selection, log selection events)
15. Update analysisStore to track selections + logging
16. DebugPanel.vue (log viewer, toggle debug mode)
17. SpectrumViewer.vue (connect to store, use selected regions, log spectrum computation)
18. ImpulseResponseDisplay.vue (IR waveform display, log IR derivation)
19. PlaybackPanel.vue (play button, volume, progress, status, log playback state)
20. ControlPanel.vue (log parameter changes)
21. Integrate Plotly for spectral plots
22. Wire store → components (selections → spectra → IR → playback, extensive logging)
23. **Unblocked**: End-to-end flow with file upload/recording, waveform selection, IR derivation, playback, debug logging

### Phase 3: Polish & Testing (Week 3)

16. Integration tests (pipeline.test.ts)
17. E2E tests (Playwright)
18. Performance optimization (FFT caching, lazy eval)
19. Export functionality (WAV + JSON)
20. Error handling & user feedback
21. **Unblocked**: Production-ready

---

---

# Visual Design System

## Design Direction

Minimalist clinical tool for audio engineers & musicians. Flat, compact, serious. DAW aesthetic (Ableton/Reaper/Cubase influences). Rounded corners soften clinical feel. Dark greys (not pure black) reduce eye strain during long sessions. Desaturated palette emphasizes data over decoration. Blue + orange spectrum colors are complementary, not saturated.

---

## Color Palette

### Light Theme
```
Ground:         #F8F8F8  (warm light grey, not pure white)
Text Primary:   #2C2C2C  (dark grey)
Text Secondary: #666666  (medium grey)
Accent:         #2563EB  (blue, interactive elements)
Spectrum A:     #2563EB  (blue)
Spectrum B:     #FF9500  (orange, complementary)
Border/Grid:    #E0E0E0  (subtle)
Success:        #34C759  (desaturated green)
```

### Dark Theme
```
Ground:         #1A1A1A  (very dark grey, NOT pure black #000000)
Text Primary:   #E5E5E5  (light grey)
Text Secondary: #999999  (medium grey)
Accent:         #3B82F6  (blue, lighter for contrast)
Spectrum A:     #3B82F6  (blue)
Spectrum B:     #FF8800  (orange, slightly saturated for visibility)
Border/Grid:    #333333  (subtle)
Success:        #30B94D  (green, slightly brighter)
```

**Implementation**:
```css
:root {
  --color-bg: #F8F8F8;
  --color-text-primary: #2C2C2C;
  --color-text-secondary: #666666;
  --color-accent: #2563EB;
  --color-spectrum-a: #2563EB;
  --color-spectrum-b: #FF9500;
  --color-border: #E0E0E0;
  --color-success: #34C759;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #1A1A1A;
    --color-text-primary: #E5E5E5;
    --color-text-secondary: #999999;
    --color-accent: #3B82F6;
    --color-spectrum-a: #3B82F6;
    --color-spectrum-b: #FF8800;
    --color-border: #333333;
    --color-success: #30B94D;
  }
}

:root[data-theme="dark"] {
  --color-bg: #1A1A1A;
  --color-text-primary: #E5E5E5;
  --color-text-secondary: #999999;
  --color-accent: #3B82F6;
  --color-spectrum-a: #3B82F6;
  --color-spectrum-b: #FF8800;
  --color-border: #333333;
  --color-success: #30B94D;
}

:root[data-theme="light"] {
  --color-bg: #F8F8F8;
  --color-text-primary: #2C2C2C;
  --color-text-secondary: #666666;
  --color-accent: #2563EB;
  --color-spectrum-a: #2563EB;
  --color-spectrum-b: #FF9500;
  --color-border: #E0E0E0;
  --color-success: #34C759;
}
```

---

## Typography

**Typefaces** (system font stack — no external CDN due to CSP):
```css
--font-display: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
--font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
--font-mono: "SF Mono", Menlo, "Courier New", monospace;
```

**Type Scale** (px):
- `11px`: captions, micro-labels (rare)
- `12px`: labels, small text, debug logs
- `14px`: body copy, regular text
- `16px`: default/normal text, input fields
- `18px`: section headers
- `22px`: subheadings
- `28px`: page title

**Usage**:
- **Headings** (22/28px): Serious, no serif. Weight 600 (semibold).
- **Body** (14/16px): Light tracking, ~65 chars wide where possible. Weight 400 (regular).
- **Mono** (12px): Data values, numeric displays, debug output. Weight 500 (monospace natural weight).
- **Labels** (12px): Interactive labels, captions. Weight 500, slight letter-spacing (0.5px).

**Rationale**: Apple Mac aesthetic — clean, minimal, serious. No playfulness. Neutral sans-serif suits clinical context.

---

## Layout & Spacing

**Rounded Corners**:
- Default: `border-radius: 8px` (cards, panels, inputs, small elements)
- Buttons: `border-radius: 20px` (pill-shaped)
- Large panels: `border-radius: 12px`

**Spacing Grid**: `8px` increments
- Micro: 4px (between closely related elements)
- Small: 8px (between items in a row/column)
- Medium: 12px (between sections within a component)
- Large: 16px (between major sections)
- XL: 24px (between major layout blocks)

**Density**: Balanced (not ultra-compact, not airy)
- Compact where data-heavy (spectrum, waveforms, logs)
- Breathing room between control sections
- Gutters/padding: 16px minimum in panels

**Layout Approach**: Flexbox/grid with `gap` (no per-element margins)

---

## Components & Interaction

### Buttons
- **Style**: Flat, pill-shaped (border-radius 20px)
- **Padding**: 8px vertical, 12–16px horizontal (depends on text length)
- **Background**: Accent color (#2563EB light, #3B82F6 dark) OR gray secondary
- **Text**: White/light on accent, dark primary on secondary
- **Icons**: Monochrome, 16–20px, leading or standalone
- **States**:
  - Default: accent background
  - Hover: 10% lighter/darker (color lighten/darken by 10%)
  - Active/Pressed: 20% darker/lighter
  - Disabled: 50% opacity, cursor not-allowed

### Icons
- **Style**: Flat, monochrome, outline-based (not filled)
- **Size**: 16px (inline), 20px (controls), 24px (header actions)
- **Color**: Text primary or accent (context-dependent)
- **Approach**: Stroke-based SVG, not bitmap

### Inputs & Controls
- **Input fields**: Border 1px --color-border, border-radius 8px, padding 8px 12px
- **Selects/Dropdowns**: Pill-shaped (border-radius 8px minimum)
- **Sliders**: Minimal (thin track, rounded thumb)
- **Checkboxes/Radios**: Custom (not native HTML), rounded corners, accent when checked

### Waveform Viewer
- **Size**: Compact but detailed (height 80–120px, or user-resizable)
- **Background**: Dark (--color-bg dark theme, or --color-border light theme for contrast)
- **Waveform color**: Text primary color (monochrome)
- **Selection region**: Accent color overlay, 20% opacity, drag-handle borders visible
- **Grid/labels**: Optional timeline labels, font-size 11px, --color-text-secondary

### Spectrum Viewer (Plotly)
- **Background**: Dark (--color-bg in dark mode, #f0f0f0 in light mode for plot visibility)
- **Grid**: Subtle/faint (--color-border, opacity 30–40%)
- **Trace A**: --color-spectrum-a (blue)
- **Trace B**: --color-spectrum-b (orange)
- **Axes**: --color-text-secondary, font-size 12px
- **Animation**: Smooth updates during IR calculation (no jarring redraws)

### Level Meter (VU-style)
- **Background**: Circular arc, --color-border outline
- **Track**: --color-border (unfilled arc)
- **Needle**: --color-accent (blue) or --color-success (green) if "safe" level
- **dB scale**: Labeled arc (-60, -40, -20, 0dB typical)
- **Real-time update**: Smooth needle motion (no frame stuttering)

### Recording Panel
- **Record button**: Pill-shaped, red/orange accent (or --color-spectrum-b orange)
- **Pulsing indicator**: Subtle pulse (opacity 1 → 0.7 → 1, 1s cycle) when recording
- **Level meter**: Inline (VU-style or bar)
- **Duration display**: Monospace 12px, right-aligned
- **Threshold slider**: Compact, below level display

### Playback Panel
- **Play button**: Pill-shaped, accent color, inline (not hero)
- **Progress bar**: Thin (4–6px), --color-border track, --color-accent fill
- **Volume slider**: Inline, compact (width 80–120px)
- **Time display**: Monospace 12px, --color-text-secondary

### IR Waveform Display
- **Size**: Medium, detailed (height 150–200px, or resizable)
- **Background**: Dark
- **Waveform**: --color-accent (blue) or --color-text-primary (monochrome)
- **Grid**: Visible, subtle (--color-border)
- **Zero-line**: Emphasized (--color-text-secondary, dashed or solid)
- **Sample markers**: Optional, small labels at major ticks
- **Metadata**: Below plot (length samples, peak amplitude, energy dB)

### Debug Panel
- **Position**: Right drawer or bottom panel, hidden by default
- **Width**: 350–400px (drawer) or ~50% height (bottom)
- **Toggle**: Button (gear icon) or keyboard (Ctrl+Shift+D)
- **Content**:
  - Filter buttons: "All" | "Debug" | "Info" | "Warn" | "Error"
  - Search input (small, --color-border)
  - Log feed: Scrollable, monospace 11px, row height 24px
  - Timestamp | Level | Source | Message | (expand for data)
  - Footer buttons: Clear | Export (JSON download)
- **Animation**: Slide-in from right/bottom, smooth

---

## Data Visualization

### Spectrum Plots
- **Type**: Plotly.js line/area charts
- **Axes**: Frequency (Hz, log scale optional), Magnitude (dB, linear)
- **Traces**: Spectrum A (blue) + Spectrum B (orange)
- **Background**: Dark (prevents eye strain, matches DAW aesthetic)
- **Grid**: Faint (subtle/faint option selected), major ticks labeled
- **Hover tooltip**: Frequency, Magnitude (dB), source (A/B)
- **Animation**: Smooth redraw when selections change or IR is computed

### Waveform Display (wavesurfer.js)
- **Background**: Slightly lighter than spectrum (contrast from --color-bg)
- **Waveform**: Monochrome (--color-text-primary)
- **Selection region**: Accent color (--color-accent), 20% opacity fill
- **Selection handles**: Draggable, cursor pointer, visible outline
- **Playback head**: Accent color, thin line
- **Interaction**: Drag region borders, click-drag to select, scroll to zoom, arrow keys to nudge

### IR Time-Domain Waveform
- **Background**: Dark
- **Waveform**: --color-accent (blue) or --color-text-primary (monochrome)
- **Grid**: Visible, --color-border
- **Zero-line**: Emphasized (dashed, --color-text-secondary)
- **Axis labels**: Sample index, amplitude
- **Metadata**: Text below (length, peak, energy, phase info if relevant)

---

## Motion & Animation

- **Spectrum during IR calc**: Subtle shimmer or gradual update (not jarring)
- **Recording pulse**: Subtle opacity pulse (1 → 0.7, 1s cycle) on record button
- **Playback progress**: Smooth line movement (no stuttering)
- **Panel open/close**: 200ms slide-in/out (drawer, debug panel)
- **Button hover**: Instant color shift (no transition — feels snappy)
- **Respect prefers-reduced-motion**: Disable animations if user has set this preference

---

## Accessibility & Performance

- **Focus states**: Visible outline (--color-accent, 2px) on all interactive elements
- **Keyboard nav**: Tab order logical (top-left → bottom-right), Shift+Tab reverse
- **Contrast**: WCAG AA minimum (21:9 ratio for text)
- **Icons + labels**: Where space allows, label buttons; bare icons require title/aria-label
- **Reduced motion**: Skip animations if `prefers-reduced-motion: reduce`
- **Font sizes**: No smaller than 11px (12px preferred for body)

---

## Terminology

- **WAV 1 (File A)**: Target spectrum — tone match destination (desired)
- **WAV 2 (File B)**: Reference spectrum — current (source)
- **IR**: Derived filter to transform spectrum B → spectrum A
- **Selection**: Time region in each file for tone-matching computation (optional; if none selected, use full file)

## Open Decisions

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| FFT Library | fft.js | Web Audio AnalyserNode | Phase info needed for IR |
| Waveform Viz | wavesurfer.js | Custom Canvas | Interactive selection OOB; custom if perf critical |
| Spectrum Viz | Plotly.js | Chart.js | Scientific UX; Chart if bandwidth critical |
| IR Phase | Preserve B | Minimum-phase | Simpler, sufficient |
| IR Length | Energy-threshold | Fixed duration | Adaptive & practical |
| Playback | Offline convolve + Web Audio | Real-time AudioWorklet | MVP simple; Phase 2 upgrade to real-time |
| Selection UI | Draw box OR drag borders | Click-and-drag timeline | Drag borders more intuitive for audio |
| Export | WAV + JSON | One only | WAV standard, JSON archive |
| State Mgmt | Pinia | Context API | Cleaner multi-component sharing |

---

## Performance Considerations

- FFT caching: Memoize per file + config
- Large files: Downsample if > 10MB
- Real-time updates: Debounce ControlPanel changes (250ms)
- Web Workers: Offload FFT for files > 5MB (optional Phase 2)
- Waveform rendering: Canvas-based, limit resolution for large files
- Convolution: Use FFT-based convolution for IRs > 1000 samples; time-domain for short IRs
- Web Audio playback: Offload to AudioContext; use ScriptProcessorNode or AudioWorklet for real-time convolution (Phase 2 optimization)

## Playback Architecture

**Phase 1 (MVP)**: Convolve offline, play back via Web Audio API
```typescript
// analysisStore.applyIR()
convolved = convolveAudio(ir, audioBuffers.A)

// PlaybackPanel.play()
const audioContext = new AudioContext()
const buffer = audioContext.createBuffer(1, convolved.length, sampleRate)
buffer.getChannelData(0).set(convolved)
const source = audioContext.createBufferSource()
source.buffer = buffer
source.connect(audioContext.destination)
source.start(0)
```

**Phase 2 (real-time)**: AudioWorklet for live convolution during playback

---

## Logging Strategy

**Level breakdown**:
- **debug**: FFT computation details, selection coordinates, buffer state changes, level meter updates (verbose)
- **info**: File loaded, recording started/stopped, spectrum computed, IR derived, playback started (user-facing milestones)
- **warn**: Large file downsampling, clipping detection, silence threshold not met (edge cases)
- **error**: Parse failures, file format errors, getUserMedia permission denied, convolution overflow (failures)

**What to log** (by module):
- `wavParser.ts`: File format, sample rate, channels, duration, parse status
- `fftProcessor.ts`: FFT size, window type, computed peak frequency (debug), energy (debug)
- `spectrum.ts`: Magnitude conversion, dB ref level, clipping corrections
- `irDerivation.ts`: Algorithm method (difference/ratio), phase strategy, truncation dB threshold, IR length samples
- `recorder.ts`: Stream state, permission granted, level dB, recording duration, auto-trigger fired
- `convolution.ts`: Convolution method (time/FFT), input/output normalization
- `analysisStore.ts`: Selection changes, state transitions, action completion

**Debug mode UI**: Bottom-right drawer with DebugPanel, toggle key (e.g., Ctrl+Shift+D)

---

## Critical Unblocking Dependencies

- `src/types/audio.ts` — Foundational interfaces (unblocks everything)
- `src/services/logging.ts` — Logging infrastructure (add early; used by all services)
- `src/services/audio/wavParser.ts` — Unblocks file loading
- `src/services/audio/fftProcessor.ts` — Unblocks spectrum computation
- `src/services/dsp/spectrum.ts` — Supports FFT → viz pipeline
- `src/services/dsp/irDerivation.ts` — Core algorithm, unblocks all visualization
- `src/services/audio/recorder.ts` — Unblocks recording input
- `src/services/audio/convolution.ts` — Unblocks playback
- `src/stores/analysisStore.ts` — Orchestrates selections → spectra → IR → playback

---

## Workflow Summary

1. User uploads WAV 1 (target) + WAV 2 (reference)
2. WaveformViewer displays both waveforms
3. User selects desired time regions in each waveform (optional; defaults to full file)
4. computeSpectra() → FFT only selected regions
5. computeIR() → derive filter from spectrum difference
6. ImpulseResponseDisplay shows IR waveform
7. Play button → convolveAudio(IR, WAV 1) → playback via Web Audio API
8. User hears WAV 1 with tone-matched spectrum (transformed toward WAV 2's character)
