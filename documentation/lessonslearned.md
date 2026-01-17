# Lessons Learned

This is a retrospective based on the prompt transcripts in `documentation/spec/`. It captures the main lessons, a rough timeline, and the places we flailed.

## Key lessons
- The Dunning-Kruger "Mount Stupid" effect is real: early confidence can hide deep knowledge gaps.
- Encoded container fragments are not the same as a PCM timeline. MP4 chunks are not guaranteed to be sequential or independently playable.
- Deterministic timing requires sample counts, not timers or container metadata.
- Observability wins: structured logs and diagnostics saved weeks of guesswork.
- When the UI is confusing, the root cause is often in the data model, not the view.
- When a bug persists across many prompts, stop tweaking and instrument the system.

## Bumps in the road
1. MP4 fragments were treated as contiguous PCM slices, which broke chunk playback and analysis.
2. The last partial chunk was repeatedly dropped due to stop/flush timing races.
3. iOS capture failures produced empty chunks with no clear error signal.
4. Volume profile noise floors jumped unexpectedly, making the histogram misleading.
5. Chunk timing drift caused analysis timelines and snip boundaries to skew.
6. Range-access decode errors hid whether corruption was in storage or playback.

## Timeline highlights (from prompt logs)
- 2025-11-05: MVP foundation, PWA shell, MediaRecorder-based capture plan.
- 2025-11-06: capture refinement, chunk flush race conditions, logging expansion.
- 2025-11-07: histogram and snip analysis, volume profile storage, scrolling fixes.
- 2025-11-08: histogram autoscroll and noise floor calibration questions.
- 2025-11-09: timing verification and diagnostic tooling to rebuild chunk timelines.
- 2026-01-15: PCM migration, MP3 encoding, doctor diagnostics, snip playback, Groq transcription.

## Example: the MP4 chunk assumption
We assumed four-second MPEG chunks were sequential and self-contained. That was wrong. MP4 fragments carry timing metadata that can overlap or rebase, so "chunk 2" might decode audio from earlier in the session. The fix was to switch to PCM-first capture, encode to MP3 ourselves, and derive timing from sample counts.

## Recommendations for AI collaboration
- Ask for a "technology reality check" when behavior feels strange.
- Prompt for explicit knowledge gaps: "What am I assuming that might be false?"
- Demand a minimal reproduction plan before big refactors.
- If you are stuck after many iterations, pause and add diagnostics instead of more tweaks.

## What we would do differently
- Start with PCM capture earlier to avoid MP4 fragment ambiguity.
- Add diagnostics and log sessions from day one.
- Test on iOS sooner to surface device-specific failures.
