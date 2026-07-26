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
- `VITE_DEBUG_MODE=true` — Enable debug logging on startup (optional)
- `VITE_LOG_LEVEL=debug|info|warn|error` — Set initial log level (default: info)
- Runtime toggle: DebugPanel.vue or keyboard shortcut (Ctrl+Shift+D)

**Waveform rendering**:
- **wavesurfer.js** (recommended): Interactive waveform, zoom, selection plugin, ~50KB. Use for MVP.
- **Custom Canvas**: Build renderer if performance critical (rare).

**Spectrum viz**: Plotly.js (~3MB); Chart.js (~60KB) if bandwidth critical.

---

## Implementation Order

### Phase 1: Core DSP Pipeline & Logging (Weeks 1-2)

1. Vite + TypeScript + Vue + Pinia setup
2. Create types (audio.ts, spectrum.ts, ir.ts)
3. logging.ts + logger setup (globally available)
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
