## Summary
- Initiate round two work on audio chunking visualization for transcription debugging.

## ✅ Done
- Logged initial requirements from user for transcription chunking debug UI.
- Implemented `analyzeRecordingChunking` utility to derive RMS frames, adaptive silence thresholds, quiet regions, and proposed chunk boundaries.
- Added developer-only chunking graph toggle in the recording detail view with SVG histogram, dashed noise baseline, and pause overlays.
- Switched the chunking graph to a logarithmic vertical scale with a draggable, scrollable one-minute viewport window and visual edge indicators.
- Updated chunk analysis heuristics to ignore the first ~120 ms and delay quiet-region detection until after an initial loud frame, while enabling on-demand analysis during active recordings with cache invalidation tied to chunk counts.
- Persisted per-chunk volume profiles immediately after capture, storing normalized frame data in IndexedDB and surfacing the records in the developer debug panel.
- Combined header and media payloads when generating per-chunk volume profiles and gracefully skip decode failures, eliminating “Decoding failed” warnings during capture.
- Reworked the chunking graph pipeline to build from cached chunk volume profiles first, falling back to on-demand decoding only when cache data is unavailable.
- Added `verifiedAudioMsec` tracking to each stored chunk (0 for seq0) and backfill missing values via the volume regeneration pass so histogram math always reflects decoded audio length.
- Simplified chunk volume storage to a compact array of normalized frame magnitudes, updated the analyzer to rebuild timelines from cached data, and added unit tests covering both the new format and legacy back-compat paths.

## 🚧 In Progress / Placeholders
- Iterate on pause detection heuristics (confidence scoring, goal-seeking against target chunk lengths).
- Surface per-break metadata (gap duration, confidence) directly in the visualization (tooltips/legends).

## ⏭️ Next Actions / Dependencies
- Define how chunking analysis should update incrementally during live capture (streaming frame ingestion).
- Identify representative audio fixtures (5–60s segments with varied noise levels) for automated testing and calibration.
- Add automated tests for percentile-based threshold selection and chunk boundary generation logic.
- Reuse stored per-chunk volume profiles when building whole-session analyses to avoid redundant audio decoding.
