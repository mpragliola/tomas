# Waver upgrade: adopt new waver features, replace bespoke recorder

Date: 2026-08-03

## Context

Tomas depends on `waver` (github:mpragliola/waver), pinned by commit hash in `package.json`.
The currently pinned commit (`5562262`) is only 3 commits past the previous pin (`4b85a32`) and
predates a large batch of new work sitting at waver's current HEAD (`558f86e`): touch gestures,
`height: "auto"`, `reset()`/`hasAudio()`, and — the big one — a full built-in mic recorder
(Record/Stop button, `startRecording`/`stopRecording`/`setInputStream`, `recordstart`/`recordstop`/
`recorderror`/`reset` events, `recordViewMode`/`recordWindowSeconds` options).

Tomas already has its own bespoke recording stack: `RecordingPanel.vue` (device picker, channel
picker, VU meter with clip indicator, auto-trigger-on-threshold, monitor) backed by
`services/audio/recorder.ts` (`AudioRecorder`, hand-built `ScriptProcessorNode` + `ChannelSplitterNode`
graph). This predates waver having any recording support of its own.

Decision (confirmed with user): fully replace the bespoke recorder with waver's native one, to slim
Tomas down. Drop the VU meter and auto-trigger entirely (waver has no equivalent and none is being
added). Keep device selection and input-channel selection in Tomas (waver deliberately has no device
picker — "Waver has no business picking an input device itself" per its own source comments — that
stays a host-app concern). Waver's recorder currently has no way to pick a channel out of a
multi-channel stream (`RecorderEngine` hard-mixes to channel 0 via `createScriptProcessor(4096, 1, 1)`),
so channel selection requires a small upstream addition to waver first.

This is a two-repo change: waver (`/home/marco/dev/waver`) gets a `channelIndex` capability added to
its recording path; Tomas then bumps its pin and replaces its recorder wholesale.

## Part A — waver: add channel selection to recording

**Problem:** `RecorderEngine.start(stream?)` connects the raw source straight into a
`createScriptProcessor(4096, 1, 1)`, taking whatever channel 0 resolves to (the browser's own
downmix for multi-channel sources). There's no way to isolate e.g. channel 2 of a stereo interface.

**Change — `src/audio/recorder-engine.ts`:**
- `start(stream?: MediaStream, channelIndex = 0): Promise<void>`.
- When the source's channel count > 1 and `channelIndex > 0`: insert a `ChannelSplitterNode` sized
  to the source's channel count, connect only the requested channel into the processor. Mirrors the
  approach already proven in Tomas's own `AudioRecorder.start()`.
- When `channelIndex` is 0, or the stream is narrower than requested: connect directly as today
  (no splitter node), and clamp/log a fallback rather than throwing if the requested channel doesn't
  exist.
- Expose the resolved channel count so a caller can tell what a device actually delivered (mirrors
  `RecorderState.inputChannels` in Tomas's current `AudioRecorder`) — add a `getInputChannelCount()`
  getter, valid after `start()`.

**Change — `src/waver-element.ts`:**
- `startRecording(stream?: MediaStream, channelIndex?: number): Promise<void>` — forwards to the
  engine. When `channelIndex` is omitted, falls back to a new `channelIndex` option set ahead of time
  (same pattern as `inputStream`/`setInputStream()`), so the built-in Record button — which always
  calls `startRecording()` with no arguments — also honors a pre-set channel.
- New `WaverOptions.channelIndex?: number` (default `0`), plus `setChannelIndex()`/`getChannelIndex()`
  methods for symmetry with `setInputStream()`/`getInputStream()`.

**Change — React/Vue wrappers:** add `channelIndex` prop, forwarded the same way `inputStream` is.

**Not in scope for waver:** device enumeration/picker UI, level metering, auto-trigger. These stay
either Tomas-side (device/channel picker) or dropped entirely (meter, auto-trigger) — no upstream
equivalent is being built for the latter two.

**Docs/tests:** update `README.md` (Recording section + options table + public API table) and
`CHANGELOG.md` (`[Unreleased]` → amend the existing recording entry to mention `channelIndex`).
Add a unit test in `RecorderEngine`'s suite covering the splitter path (multi-channel source, request
channel 1, verify only that channel's data reaches `onData`) and the fallback (request channel 5 on a
2-channel source).

## Part B — Tomas: bump pin, replace the recorder

**1. Dependency bump.** After Part A lands and is committed in waver, update
`package.json`'s `waver` entry to the new commit hash, `npm install`.

**2. Fix the prop rename.** `WaveformEditor.vue` currently passes boolean
`:show-load-button="false" :show-record-button="false"` — these no longer exist at the new pin
(renamed to string-enum `load-button`/`record-button` sometime before `5562262`, confirmed still
present as booleans at the *currently* pinned commit, so this is a "breaks on bump," not a live bug).
Change to `load-button="hidden"` (file loading stays via the existing drag-and-drop `AudioSlot`/
`ReferenceSlot` UI, not waver's own Load button) and `record-button="enabled"` (this is the one we're
now adopting).

**3. Delete (bespoke recording stack, fully superseded):**
- `src/components/RecordingPanel.vue` (the whole VU-meter/auto-trigger/duration panel)
- `src/services/audio/recorder.ts` (`AudioRecorder`)
- `src/composables/useMonitor.ts`
- `src/utils/vuMeter.ts` (and its usages in the deleted panel)
- Store (`analysisStore.ts`): `recorder`, `recordAudio()`, `stopRecording()` bodies tied to the old
  `AudioRecorder` — replaced per point 6 below. Types `RecorderConfig`/`RecorderState` in
  `types/audio.ts` (threshold/duration/level fields have no waver equivalent; device/channel
  selection moves to the trimmed picker in point 4/5, not these types).
- Empty-state Record/Stop buttons and `record`/`stop-record` emit chain: `AudioSlot.vue`,
  `ReferenceSlot.vue`, `FileUpload.vue`, `App.vue` (`onRecord`/`onStopRecord`/`onRecorded`,
  `recordingPanel` ref). Each `WaveformEditor`'s embedded `Waver` now owns its own Record/Stop button
  natively (via `record-button="enabled"`), so the parent-level plumbing for triggering record on a
  slot goes away — a slot's `Waver` instance handles clicks itself.

**4. Keep, trimmed: device + channel picker.** `useAudioDevices.ts` keeps device enumeration and
`selectedDeviceId`; channel picking stays too but now aims at waver's new `channelIndex`
parameter/prop rather than a local `ChannelSplitterNode` — Tomas no longer opens the mic stream
itself for the purpose of splitting; it only needs `getUserMedia` to enumerate/label devices (as
`useAudioDevices` already does for its dropdown) and to obtain a `MediaStream` for the *chosen
device* to hand to waver via `setInputStream()`/`inputStream` prop, letting waver's engine do the
channel split via the new `channelIndex`.

**5. Replacement UI: slim device/channel picker panel.** Replace the deleted `RecordingPanel.vue`
sidebar panel with a much smaller one — just the "Input device" and "Input channel" dropdowns (no
meter, no auto-trigger, no duration readout). This panel doesn't drive recording start/stop anymore
(each slot's `Waver` does that itself); it only holds the selected device/channel in the store so
that whichever slot starts a recording can read them.

**6. Wiring recording into the store.** `WaveformEditor.vue`'s `<Waver>` gets `record-button="enabled"`
and, right before a user presses its Record button, needs `inputStream`/`channelIndex` already set to
the current picker selection — set them reactively (a `watch` on the store's selected device/channel
that calls `setInputStream()`/opens a stream for the chosen device) so waver's own button uses them
with no explicit `startRecording()` call needed from Tomas.
- On `@recordstart`: set `store.recordingTarget` to this slot's target (for the one-at-a-time lock,
  point 7).
- On `@recordstop`: pull the captured audio back out and save it into the store at this instance's
  target (`store.audioBufferA` for `'A'`, or the reference's asset for a reference tab) — same place
  file-load already writes to, so the rest of the pipeline (spectrum scheduling, playback) needs no
  changes. Clear `store.recordingTarget`.
- On `@recorderror`: surface via the existing `status` emit / toast path.

**7. One active recording at a time.** Keep `store.recordingTarget: RecordTarget | null` as a pure UI
lock flag (no longer tied to the old `AudioRecorder`). Every `WaveformEditor` instance computes
`record-button="store.recordingTarget && store.recordingTarget !== thisTarget ? 'disabled' : 'enabled'"`,
using waver's own `recordButton` states instead of a hand-rolled `recordingElsewhere` disabled button.

**8. Everything else new in waver — adopt for free, no design needed:** touch pinch/pan (automatic,
same element), `reset()`/`hasAudio()` (not currently needed by any flow — skip unless a use turns up),
`height: "auto"` (current fixed `:height="96"` still works — skip, no reason to change).

## Testing

- Waver: new unit test for the channel-split path in `RecorderEngine` (Part A).
- Tomas: existing Playwright/vitest coverage around `WaveformEditor`/`AudioSlot`/`ReferenceSlot`
  recording flows needs updating to match the new record-button-per-instance model (grep for
  `RecordingPanel`/`onRecord`/`stopRecording` in spec files once implementation starts).
- Manual: record into A, record into a reference tab, verify one-at-a-time locking disables other
  slots' Record buttons, verify device/channel picker selection is honored (test with a real
  multi-channel interface if available, otherwise verify the `channelIndex` plumbing via unit test
  only).

## Out of scope

- Level meter / VU display (dropped, no replacement, per user decision).
- Auto-trigger-on-threshold recording (dropped, no replacement).
- Device enumeration inside waver itself (stays a Tomas-side concern, matching waver's existing
  design boundary).
- `recordViewMode`/`recordWindowSeconds` tuning — defaults are fine, revisit only if the record-time
  waveform view looks wrong in practice.
