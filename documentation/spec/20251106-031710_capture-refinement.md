# Capture Refinement & Chunk Integrity — Iteration Log

**Prompt slug:** `capture-refinement`  
**Last updated:** 2025-11-06 03:17 UTC

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

## Outstanding Items

- Verify the recorder flush across Safari/iOS once hardware access is available; current fix is based on Chromium semantics.
- Volume perception issue remains under investigation—no gain adjustments were applied in this round.
- Continue monitoring log sessions for “Final flush completed without non-empty chunk” warnings to detect edge cases.

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
