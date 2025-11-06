# Debugging Guide

This guide explains how to validate chunk metadata, interpret the new log entries, and confirm that durations match the underlying audio. Use it when QA reports timing anomalies or missing audio.

## 1. Developer Overlay Overview

The overlay (toggle via 🐞) exposes two tabs:

1. **IndexedDB** – lists sessions and chunks, including `seq`, `startMs`, `endMs`, `blobSize`, and `verifiedByteLength`. The chunk list matches the metadata saved in IndexedDB.
2. **Logs** – chronological view of log entries emitted by `captureController` and other modules. Filter using the dropdown to jump between sessions.

### Keyboard Shortcuts

- Press `Esc` to close any overlay quickly.
- Use the left/right arrows in the Logs tab to move between log sessions.

## 2. Confirming Chunk Integrity

1. Start a test recording (e.g., 12 seconds). After stopping, open the developer overlay → IndexedDB tab → `chunks` table.
2. Check for each sequence number:
   - `seq === 0` should have `isHeaderChunk` flagged (in the JSON) and `blob.size` > 0 but `startMs === endMs` (init metadata). This chunk is expected to be “zero seconds.”
   - For `seq > 0`, verify that `endMs - startMs` roughly matches four seconds (except the final chunk, which can be shorter).
   - `blob.size` should be larger than zero. If zero, refer to the log entry `Received empty audio chunk` to diagnose the cause.
3. Confirm that the final chunk’s `endMs` is close to the session’s `updatedAt` timestamp.

## 3. Reading Log Entries

| Log Message | Meaning | Follow-up |
| --- | --- | --- |
| `Requesting microphone stream` | A new recording is being seeded. | If no follow-up appears, the user likely denied mic access. |
| `Chunk captured` with `timecode: null` | We fell back to `Date.now()` for duration. | Ensure there is a matching `Chunk persisted` and inspect `durationMs`. |
| `Chunk duration fallback applied` | Browser omitted `event.timecode`; we calculated duration manually. | Consistent occurrence is normal on Safari. If it happens mid-session on Chrome, note the timing. |
| `Final flush produced chunk` | Stop routine yielded one last chunk. | If missing, the recorder may have stopped prematurely (look for warnings). |
| `Final flush completed without non-empty chunk` | We asked for trailing data but none arrived. | Inspect subsequent chunks for zero length; user may have denied mic mid-recording. |
| `Session timing reconciled` | Manifest totals were recomputed; log includes final duration/size. | Cross-check with session list to confirm UI shows the same duration. |

## 4. Verifying Playback Duration

1. Open a session detail view and hit play. Observe the timer `current / total` under the transport controls.
2. In Developer Mode, expand the chunk list; sum the `durationMs` values (UI shows seconds). They should match the total playback duration.
3. If the UI reports a shorter duration than playback, inspect the chunk metadata for incorrect `startMs`/`endMs`. Use log timestamps to identify when the mismatch began.

## 5. Checking IndexedDB Directly

If the developer overlay doesn’t reveal the issue, open DevTools → Application → IndexedDB → `durable-audio-recorder`.

- Inspect the `chunks` object store; confirm each entry’s `startMs`, `endMs`, and `byteLength`.
- Use the “Download chunk” feature in the overlay (▶/⬇ buttons) to validate that the `Blob` plays independently.
- Clear stores between tests (Developer overlay → “Reset DB”) to avoid stale data interfering with new recordings.

## 6. Common Failure Modes

| Symptom | Likely Cause | Remedy |
| --- | --- | --- |
| All chunks show identical `startMs` | Controller wasn’t updating `#lastChunkEndMs` (should be fixed by latest patch). If it reappears, look for skipped `Chunk captured` logs. | Reload app after clearing the DB; check logs for errors. |
| Duration in UI shorter than playback | Some chunks had zero or tiny duration due to missing timecodes. | Compare log `timecode` values and ensure fallback durations look reasonable. |
| Playback stalls | `buildSessionBlob` returned `null` because no audio chunks were stored. Likely due to denied microphone or persistent zero-length chunks. | Re-run with developer overlay open to watch logs as it happens. |

## 7. Next Steps

- If timing issues persist, capture the log session via “Download logs” (coming soon) or manually export the log entries using the IndexedDB inspector.
- File an issue with the sequence of log messages and chunk metadata; include browser/OS details to reproduce.

With these diagnostics you can distinguish between recorder glitches (browser/OS) and application logic regressions. When in doubt, capture the logs immediately after reproducing the problem and compare them with the expected timeline described in `capture-flow.md`.
