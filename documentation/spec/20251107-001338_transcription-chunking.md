## Summary
- Initiate round two work on audio chunking visualization for transcription debugging.

## ✅ Done
- Logged initial requirements from user for transcription chunking debug UI.
- Implemented `analyzeRecordingChunking` utility to derive RMS frames, adaptive silence thresholds, quiet regions, and proposed chunk boundaries.
- Added developer-only chunking graph toggle in the recording detail view with SVG histogram, dashed noise baseline, and pause overlays.

## 🚧 In Progress / Placeholders
- Iterate on pause detection heuristics (confidence scoring, goal-seeking against target chunk lengths).
- Surface per-break metadata (gap duration, confidence) directly in the visualization (tooltips/legends).

## ⏭️ Next Actions / Dependencies
- Define how chunking analysis should update incrementally during live capture (streaming frame ingestion).
- Identify representative audio fixtures (5–60s segments with varied noise levels) for automated testing and calibration.
- Add automated tests for percentile-based threshold selection and chunk boundary generation logic.
