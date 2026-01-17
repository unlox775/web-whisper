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
