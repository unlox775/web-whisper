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

## 🚧 In progress

- 20260115-045056: Add a “Doctor” diagnostics tool to isolate chunk/snips corruption issues:
  - UI: 🩺 button in the session detail panel.
  - Diagnostics: run selectable tests and render a green/yellow/red bar + summary.
  - Tests: compare “raw IndexedDB/chunk coverage” vs “audio slice API range access” at 0.1s resolution.

## ⏭️ Next actions

- Update `documentation/README.md` status line(s) once snips are actually surfaced in the UI.
- Add/extend unit tests around slice resolution and stitching (where feasible without real audio fixtures).
- Ensure `npm run build` passes and commit build artifacts as required by repo policy.

