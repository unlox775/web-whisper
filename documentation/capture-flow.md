# Capture Flow – Step-by-Step Timeline

This document narrates a complete recording session, highlighting each event, the modules involved, and the logs you should expect to see. Use it alongside the developer console when diagnosing issues.

## 0. Preconditions

- `initializeLogger()` has started a new log session.
- `settingsStore` is loaded and the UI has rendered the idle state.

## 1. User Presses “Start Recording”

1. `App.tsx` generates `sessionId = crypto.randomUUID()`.
2. `manifestService.createSession({ id, startedAt, status: 'recording', ... })` inserts a stub row.
3. `captureController.start({ sessionId, targetBitrate, chunkDurationMs: 4000 })` is invoked.
4. Controller calls `manifestService.init()` (no-op if already open) and logs `Requesting microphone stream`.
5. `getUserMedia` resolves → controller logs `Microphone stream acquired`.
6. `selectMimeType` chooses AAC if supported; controller instantiates `MediaRecorder`.
7. Event listeners are registered:
   - `dataavailable`
   - `stop`
   - `error`
8. `recorder.start(4000)` kicks off encoding. Controller logs `MediaRecorder started`.
9. Controller updates state → subscribers (UI) show “Recording” pill, zero elapsed time.

## 2. Every 4 Seconds (`dataavailable` Event)

1. Recorder dispatches `dataavailable` with a `Blob`.
2. Controller checks `event.data.size`:
   - If zero → logs `Received empty audio chunk` with `recorder.state` and `requestedTimesliceMs`.
   - Otherwise → continues.
3. Controller determines chunk metadata:
   - `chunkStart = lastChunkEndMs`
   - `chunkDuration = event.timecode ?? (Date.now() - chunkStart)`
   - `chunkEnd = chunkStart + chunkDuration`
   - `isHeaderChunk = seq === 0`
4. Controller logs `Chunk captured` with `durationMs`, `chunkStartMs`, `chunkEndMs`, and `timecode`.
5. Chunk is enqueued for persistence via `manifestService.appendChunk` (executed sequentially).
6. On success controller logs `Chunk persisted` and increments state (`chunksRecorded`, `bytesBuffered`, `lastChunkAt`).
7. UI updates developer strip showing new chunk count and buffered size.

## 3. Interacting While Recording

- UI polls `manifestService.listSessions()` every few seconds (or on state change) to refresh durations and status text.
- Developer overlay can fetch `manifestService.getChunksForInspection()` without disrupting capture.
- If developer opens the detail view mid-recording, playback controls are disabled until at least one non-header chunk exists.

## 4. User Presses “Stop Recording”

1. UI calls `captureController.stop()`.
2. Controller sets state to `stopping` and logs `Recorder stop requested`.
3. If the recorder is still `recording`, controller logs `Flush initiated before stop` and triggers `#flushRecorder`:
   - `requestData()` is called and logged.
   - The next `dataavailable` is awaited (or timeout). If the chunk is non-empty, controller logs `Final flush produced chunk`; otherwise a warning is emitted.
4. Once `MediaRecorder.state` becomes `inactive`, the controller detaches listeners and logs `MediaRecorder stop event fired`.

## 5. Reconciling Session Metadata

1. `await this.flushPending()` ensures all chunk writes are finished.
2. Controller retrieves chunk metadata via `manifestService.getChunkMetadata(sessionId)`.
3. Duration/bytes totals are recomputed (ignoring header chunk).
4. Controller constructs `updatePatch` and calls `manifestService.updateSession(...)`.
5. Controller logs `Session timing reconciled` with status, duration, total bytes, and chunk count.
6. Controller resets internal fields (`#mediaRecorder`, `#stream`, etc.) and sets state to `idle`.

## 6. UI Refresh

1. `App.tsx` reloads the session list (now showing status `Ready` or `Error`).
2. If developer detail view is open, it calls `manifestService.getChunkData(sessionId)` to populate the chunk list.
3. Playback button is enabled; pressing it assembles a blob via `manifestService.buildSessionBlob` and plays through the hidden `<audio>` element.

## 7. Developer Console Reference

Log statements you should see in chronological order:

1. `Requesting microphone stream`
2. `Microphone stream acquired`
3. `MediaRecorder started`
4. Repeated: `Chunk captured` → `Chunk persisted`
5. On stop: `Recorder stop requested`
6. `Flush initiated before stop`
7. `requestData issued for final flush`
8. `Final flush produced chunk` (or warning if empty)
9. `MediaRecorder stop event fired`
10. `Session timing reconciled`

If any of these are missing, the developer overlay (`Debug → Logs`) will make it visible. Matching timestamps with chunk metadata helps identify drift or missing events.

## 8. Error Handling

- If `getUserMedia` rejects, the exception bubbles up to the UI and a session stub is marked with `status: 'error'` + explanatory note.
- If `MediaRecorder` fires an `error` event mid-session, the controller sets state to `error`, logs details, and still attempts to flush/persist whatever data is available.
- The developer overlay shows failed chunks (size zero) and red “Error” pills so QA can spot the failure quickly.

Use this timeline to cross-check the new documentation in `technology.md`, `pcm-walkthrough.md`, and `debugging.md`. Together they describe **what** should happen, **how** the underlying APIs behave, and **where** to look when things get weird.
