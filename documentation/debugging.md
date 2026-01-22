# Debugging Guide

This guide explains how to inspect capture data, interpret logs, and run diagnostics.

## 1. Developer mode overview
- Enable Developer mode in Settings.
- The bug icon in the header opens the Developer Console.
- The bug icon in a session detail view reveals chunk and snip lists.
- The doctor icon opens diagnostics for the selected recording.

## 2. Developer Console (header bug icon)
Two tabs are available:
1. IndexedDB tables: sessions, chunks, chunkVolumes, snips, logSessions, logEntries.
2. Logs: per-session log entries with timestamp, level, message, and details.

## 3. Log messages you should expect
- `Recorder start requested`
- `Requesting microphone stream`
- `Microphone stream acquired`
- `PCM capture started`
- `PCM chunk encoded` (debug)
- `Chunk persisted`
- `Chunk volume profile stored`
- `Recorder stop requested`
- `Session timing reconciled`

If a message is missing, check the log session for errors around that time.

## 4. Chunk integrity checklist
- For MP3 sessions, `seq 0` is real audio.
- For legacy MP4 sessions, `seq 0` may be an init segment.
- `endMs` should be greater than `startMs`.
- `byteLength` should be larger than zero for audio chunks.

## 5. Volume profiles and analysis
Each chunk should have a volume profile entry. Missing profiles can:
- prevent timing verification
- shrink the histogram timeline
- generate incorrect snips

Regenerate missing profiles via diagnostics or by re-opening the session.

## 6. Doctor diagnostics
The doctor panel runs targeted checks:
- Sanity checks (session duration, chunk sums, snip bounds)
- Chunk coverage scan (IndexedDB timing coverage)
- Range access scan (decode and inspect slices)
- Per-chunk decode scan
- Snip scan (validate snip ranges)

Each test provides a summary, grouped findings, and JSON export.

## 7. Common issues
- No audio captured: verify microphone permissions and look for `No PCM audio callback detected`.
- Timing drift: run timing verification and ensure volume profiles exist.
- Legacy MP4 artifacts: consider purging old MP4 sessions.

## 8. No-audio capture example (2026-01-21)
This is a captured no-audio session to keep as a reference when debugging future incidents.

Doctor report (compact):
- Session: 956931e5-a8c6-459b-bc05-f649a4653661
- StartedAt: 2026-01-21T15:34:08.579Z
- DurationMs: 0 (=0.0s)
- Mime: audio/mpeg  Chunks: 0  Timing: unverified

Recent logs (last 30):
- 2026-01-21T15:17:27.197Z info Chunk persisted
- 2026-01-21T15:17:27.261Z debug Chunk volume profile stored
- 2026-01-21T15:17:27.654Z info Recorder stop requested
- 2026-01-21T15:17:27.678Z debug PCM chunk encoded
- 2026-01-21T15:17:27.687Z info Wake lock released after recording
- 2026-01-21T15:17:27.696Z info Chunk persisted
- 2026-01-21T15:17:27.711Z debug Chunk volume profile stored
- 2026-01-21T15:17:27.718Z info Session timing reconciled
- 2026-01-21T15:17:27.719Z info Recorder stopped
- 2026-01-21T15:17:30.615Z error Snip transcription failed
- 2026-01-21T15:17:33.649Z info Playback source prepared
- 2026-01-21T15:17:36.239Z info Snip transcription started
- 2026-01-21T15:17:37.402Z info Snip transcription completed
- 2026-01-21T15:34:06.245Z info Detail view closed
- 2026-01-21T15:34:07.058Z info Recorder start requested
- 2026-01-21T15:34:07.060Z info Wake lock acquired for recording
- 2026-01-21T15:34:07.068Z info Requesting microphone stream
- 2026-01-21T15:34:07.073Z info Wake lock released after recording
- 2026-01-21T15:34:08.551Z info Microphone stream acquired
- 2026-01-21T15:34:08.579Z info PCM capture started
- 2026-01-21T15:34:08.584Z info Recorder started
- 2026-01-21T15:34:08.589Z info Wake lock acquired for recording
- 2026-01-21T15:34:17.586Z warn No PCM audio callback detected within timeout
- 2026-01-21T15:34:23.590Z info No global errors captured during recording start window
- 2026-01-21T15:34:23.590Z warn No audio captured after timeout; stopping recording
- 2026-01-21T15:34:23.601Z info Recorder stop requested
- 2026-01-21T15:34:23.620Z info Wake lock released after recording
- 2026-01-21T15:34:23.624Z error Session completed without playable audio
- 2026-01-21T15:34:23.628Z info Session timing reconciled
- 2026-01-21T15:34:23.629Z info Recorder stopped
