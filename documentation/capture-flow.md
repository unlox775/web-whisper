# Capture Flow - Step-by-Step Timeline

This document narrates a complete recording session with the current PCM-first pipeline.

## 0. Preconditions
- `initializeLogger()` has started a new log session.
- `settingsStore` is loaded and the UI is idle.

## 1. User presses "Start recording"
1. `App.tsx` creates a `sessionId` and inserts a session row via `manifestService.createSession`.
2. `captureController.start({ sessionId, targetBitrate, chunkDurationMs: 4000 })` is invoked.
3. The controller calls `getUserMedia` with audio constraints.
4. An AudioContext graph is created:
   - MediaStream source -> ScriptProcessor -> mute gain -> destination.
5. The controller logs `PCM capture started` and updates session metadata.

## 2. PCM processing loop (every audio callback)
1. `onaudioprocess` receives a Float32 PCM block.
2. The block is converted to Int16 and appended to a pending buffer.
3. `capturedMs` is updated based on sample count, not wall-clock time.
4. When pending samples exceed the chunk target, a flush is triggered.

## 3. Chunk flush
1. Pending Int16 blocks are encoded to MP3 via Lame.js.
2. A chunk record is created using sample-based `startMs` and `endMs`.
3. `manifestService.appendChunk` persists the blob and updates session totals.
4. A volume profile is computed and stored for analysis.
5. Logs include `PCM chunk encoded`, `Chunk persisted`, and `Chunk volume profile stored`.

## 4. While recording
- The UI shows live duration from the capture state.
- Developer mode shows chunk count and buffered size.
- The analysis pipeline can run mid-recording using stored chunk volume profiles.

## 5. User presses "Stop recording"
1. `captureController.stop()` flushes any remainder chunk.
2. The controller waits for the persist queue to finish.
3. The session is reconciled and marked `ready` or `error`.
4. Logs include `Recorder stop requested` and `Session timing reconciled`.

## 6. No-audio watchdogs
- The controller warns if no audio callback is detected within 9 seconds.
- The UI stops the recording if no chunks appear after a longer timeout.

## 7. Playback and follow-up actions
- Full playback uses `manifestService.buildSessionBlob`.
- Chunk and snip playback use `recordingSlicesApi`.
- Snip transcription can run after recording if a Groq key is configured.
