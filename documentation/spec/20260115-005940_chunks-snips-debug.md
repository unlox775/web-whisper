# Chunks vs Snips debug panel + per-item playback/download

## Goal

Fix the recording detail “debug” (bug icon) panel so:

- Chunk row **Play** plays that specific chunk (not always from beginning).
- Chunk row **Download** downloads that specific chunk’s audio.
- Add a **Chunks / Snips** toggle at the top.
- In **Snips** mode, list analysis-derived snips and support Play/Download for each snip, including snips that span chunk boundaries (stitched).

## Assumptions

- “Chunks” are the raw capture segments as persisted (MediaRecorder/Web Audio pipeline), currently shown in the debug panel.
- Chunk list includes an index `0` entry that is effectively a header / non-playable metadata row; chunk rows from `1..n` are playable.
- “Snips” are computed logical segments based on quiet gaps/analysis and should be addressable as `snip 1`, `snip 2`, etc (no special “0” header row).

## ✅ Done

- Logged prompt transcript for this iteration (`documentation/spec/20260115-005940_chunks-snips-debug-PROMPT.txt`).
- Fixed the debug chunk list **Play** behavior so each chunk plays its own audio (no session-relative seeking).
- Added a `Chunks / Snips` toggle in the detail debug panel.
- Implemented `recordingSlicesApi` (`src/modules/playback/recording-slices.ts`) to resolve:
  - chunk audio blobs (with init-segment prefixing for mp4-like formats when available)
  - snip audio ranges as WAV (decode full session, slice by ms, encode PCM16 WAV)
- Wired snip list rendering to the existing analysis segments and enabled per-snip **Play**/**Download**.
- 20260115-175214: PCM capture now updates the session `startedAt` to the actual capture-start time (after mic/audio graph setup), so `session.durationMs` and Doctor range-based checks don’t include setup latency.
- 20260115-175214: Doctor “volume profile” sanity check now includes `seq=0` for MP3 sessions (it previously filtered `seq > 0`, creating a false “missing 1 profile” warning).
- 20260115-180115: Doctor now forces a stable snapshot (fresh session from IndexedDB + cache clear + best-effort timing verification) so results don’t change just because you refreshed.
- 20260115-203800: Added first-class snip records in IndexedDB, including transcription payloads and errors, plus a new developer console table to inspect them.
- 20260115-203800: Snip list now renders stored snips, with per-snip retry transcription and Groq error surfaces.
- 20260115-203800: Detail view shows concatenated snip transcription text with status/error metadata.
- 20260115-211200: Simplified snip transcription payloads to store timestamped phrase segments instead of word-level entries.
- 20260115-221500: Snip list now displays transcription text with tap-to-select for easy copying.
- 20260115-221500: Auto-transcribe snips when recording stops (serial Groq calls) and show previews in the session list.
- 20260115-221500: Added per-recording delete action plus a 15s no-audio timeout that beeps and stops recording.

## 🚧 In progress

- 20260115-045056: Add a “Doctor” diagnostics tool to isolate chunk/snips corruption issues:
  - UI: 🩺 button in the session detail panel.
  - Diagnostics: run selectable tests and render a green/yellow/red bar + summary.
  - Tests: compare “raw IndexedDB/chunk coverage” vs “audio slice API range access” at 0.1s resolution.

## ⏭️ Next actions

- Add/extend unit tests around slice resolution and stitching (where feasible without real audio fixtures).
- Ensure `npm run build` passes and commit build artifacts as required by repo policy.
- Add auto-transcription (post-snip) and optional word-level playback highlighting.

