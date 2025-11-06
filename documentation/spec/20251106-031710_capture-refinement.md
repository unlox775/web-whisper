# Capture Refinement & Chunk Integrity — Iteration Log

**Prompt slug:** `capture-refinement`  
**Last updated:** 2025-11-06 04:25 UTC

## Context

- Developer feedback flagged two regressions: a phantom zero-duration “chunk 0” and a missing final segment whenever recording stops abruptly.
- Playback of individual developer chunks threw `NotSupportedError` because mp4 data slices lacked the AAC init segment.
- Manual QA requested direct downloads for each chunk and clearer logging/spec notes describing the stop-order race condition.

## What Changed

### Capture Pipeline Safeguards
- Reworked `captureController.stop()` (`src/modules/capture/controller.ts`) to flush a non-empty `dataavailable` slice **before** issuing `recorder.stop()` and to keep the microphone alive until persistence finishes.
- Added `#flushRecorder()` helper that loops on `requestData()` until a meaningful blob arrives (or times out) and logs when the recorder stops without delivering audio.
- Delayed stream teardown to after `flushPending()` so the recorder, manifest writes, and cleanup happen deterministically.

### Developer Instrumentation & UX
- Normalised init-segment handling in `App.tsx`: header chunks stay persisted for concatenation but are excluded from dev counts (`playableChunkCount`) and flagged as “init segment”.
- Fixed per-chunk playback by compositing the header blob with the target chunk before creating an object URL, eliminating the `NotSupportedError` on segment 2+.
- Added per-chunk download controls (developer mode) that emit timestamped filenames (e.g., `2025-11-06T03-17-05_chunk-02.mp4`).
- Updated the developer strip to show `Segments: N + init`, reducing confusion about the synthetic first slice.
- Tightened chunk debugging UI/CSS (`App.css`) to support the new download pill while keeping spacing consistent.
- Session cards now surface timestamp/size metadata in the top-right corner, squeeze vertical padding, and pulse briefly when a recording transitions to `ready`.
- Erroring sessions inherit a red accent and display the captured failure note in place of “Transcription pending…”.
- Active recordings now show a live timer (seconds since start) in both the capture control card and the session list, switching back to persisted duration once capture completes.
- Playback modal preloads duration metadata so the scrubber displays total length immediately; header duration, list duration, and audio metadata now align.
- Persisted session duration now re-computes from final chunk timestamps using real wall-clock fallbacks, eliminating the previous ~4 s underrun on partial timeslices.

### Modal Interaction & Live View Polish
- Clicking outside any overlay (detail drawer, settings, or developer console) now dismisses it—no more hunting for the close button on touch devices.
- The transcription detail dialog exposes per-chunk download buttons and keeps developer metadata collapsed until toggled.
- Recordings list becomes its own scroll region on narrow screens (`-webkit-overflow-scrolling: touch`), so long histories stay manageable on iPhone.
- The simulated live-transcription panel only mounts while recording, fades away when capture stops, and resets its stream when a new session begins.
- Live transcription floats as a fixed overlay near the bottom of the viewport, ensuring it remains visible on mobile without manual scrolling; the session list gains bottom padding so entries remain accessible beneath the overlay.
- The transcription stream itself became scrollable (with inertial scrolling on touch) so longer simulated text can be reviewed, while leaving the recordings list scrollable underneath.

### Mobile Interaction Guardrails
- Disabled browser pinch-zoom via viewport directives plus gesture/touch listeners, preventing accidental zoom on iOS Safari.
- Added an explicit viewport-fit directive so the layout hugs device-safe areas when installed as a PWA.
- Header spacing was tightened, the marketing tagline removed, and the page shell now prevents accidental scrolling of the chrome while the session list remains scrollable.

### iOS Diagnostics & Session Health
- When Safari delivers an empty `dataavailable`, the logger now captures recorder state, requested timeslice, timecode, and track readiness to help triage permission or encoder issues.
- Post-stop reconciliation inspects persisted chunks; sessions without any playable audio are automatically marked `error` with a descriptive note and emit a log entry summarising chunk counts and total bytes.
- Session metadata is normalised on stop, recomputing duration/byte totals from the stored chunk manifests so short (<4 s) captures render consistent lengths across list, detail, and playback UI.

## Outstanding Items

- Verify the recorder flush across Safari/iOS once hardware access is available; current fix is based on Chromium semantics.
- Volume perception issue remains under investigation—no gain adjustments were applied in this round.
- Continue monitoring log sessions for “Final flush completed without non-empty chunk” warnings to detect edge cases.
- Validate the new zero-audio classification on real iOS hardware and tune heuristics if header-only blobs surface.

## Technical Notes

### AAC Init Segment Behaviour

- Safari/Chromium emit a short AAC init segment (ftyp/moov) on `seq === 0`. Without it, later mp4 slices are unplayable. The UI now treats this blob as control data: it is kept for concatenation/downloads but omitted from user-facing counts.

### Stop-Order Race Condition

- Prior implementation called `recorder.stop()` immediately after `requestData()`, causing the microphone track to close before the partial chunk arrived; some browsers responded with an empty `Blob`.
- New flow:
  1. Invoke `requestData()` and wait (up to 1.2 s) for a non-empty `dataavailable` event.
  2. Only after the flush resolves is `recorder.stop()` issued, with an explicit promise to await the `stop` event.
  3. Persist queue is drained (`flushPending()`), then tracks/ports are torn down.
- Warn-level log records when a timeout or stop event fires without audio so QA can correlate future anomalies.

### Capture Timing Instrumentation

- Each `dataavailable` is now inspected for a reliable `event.timecode`; when absent, we record the wall-clock delta (`Date.now() - chunkStart`) and emit `Chunk duration fallback applied` with the fallback length and recorder state.
- `Chunk captured` debug logs now include `chunkStartMs`, `chunkEndMs`, and the raw timecode so we can correlate the stored timestamps with the wall-clock moments visible in the developer log overlay.
- When `stop()` begins while the recorder is still active, we log `Flush initiated before stop` followed by `requestData issued for final flush`, making the flush timeline explicit.
- After flushing and reconciling manifest data we log `Final flush produced chunk` (or the existing warning if nothing arrived) and finally `Session timing reconciled` with the recomputed `durationMs`, `totalBytes`, and chunk count so discrepancies are easy to spot.
- These logs surface in the in-app developer console; the session list now reflects the recomputed `durationMs`, so any divergence between logs and UI can be tracked quickly.
