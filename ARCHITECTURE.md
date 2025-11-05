## Durable Audio Recording PWA – Architecture Plan

### 1. System Overview
- **Goal**: Continuous AAC capture in the browser with parallel PCM analysis, durable chunk persistence, live transcription, and resilient recovery on PWA-capable browsers (with emphasis on iOS Safari).
- **Key Principles**: never drop more than one timeslice, avoid MediaRecorder restarts, prioritize buffered durability, operate within iOS storage/background limits, and deliver near-live transcription and analytics.

### 2. Runtime Modules & Responsibilities
- **`CaptureController`** (Main thread)
  - Manages `getUserMedia` lifecycle and permissions.
  - Creates shared `MediaStream` for encoder and analysis branches; handles device change, visibility events, graceful stop.
  - Orchestrates start/stop, monitors ring buffer health, surfaces UI status.
- **`RecorderBranch`**
  - Wraps `MediaRecorder` with AAC MIME selection and 3–5 s `timeslice` cadence.
  - Converts each `Blob` into chunk metadata `{id, sessionId, startMs, endMs}` and hands off to `ChunkStore` and `UploadWorker` queue.
  - Maintains rolling `sessionClock` synced to `AudioContext` time for accurate timestamps.
- **`AnalysisBranch`**
  - Creates `AudioContext` with an `AudioWorkletNode` (fallback: `ScriptProcessorNode`).
  - `AudioWorkletProcessor` calculates DSP metrics per frame: RMS (broad & band-limited), ZCR, spectral centroid/rolloff (via Meyda or custom).
  - Implements adaptive baseline tracking, cadence histogram, hysteresis VAD decisions, zero-cross alignment, and emits `SnipProposal` messages.
  - Maintains a PCM ring buffer (2–3 s) for post-roll adjustments.
- **`ChunkStore`**
  - Dexie-based IndexedDB schema for `chunks`, `snips`, `transcriptionJobs`, `storageStats`.
  - Ensures idempotent writes, eviction policy when `bytesBuffered` exceeds budget, boot-time recovery replay.
- **`UploadWorker`** (Dedicated Worker)
  - Streams pending chunks to server (`POST /upload-chunk`) with exponential backoff and jitter.
  - Handles offline detection, Resume-After headers, concurrency throttling, telemetry metrics (latency, retries).
  - Updates `chunks.status`, records `bytesUploaded`, exposes health info to UI.
- **`TranscriptionWorker`**
  - Maintains sliding 30 s windows with 1 s overlap, preferring snip boundaries; falls back to soft timeout decisions.
  - Fetches (or assembles) blobs for windows, calls Groq/Whisper via supplied API key, parses word-level timestamps.
  - Emits incremental caption updates and final transcripts, handles retry with capped attempts.
- **`ManifestService`**
  - Facade providing async API (`loadSession`, `appendChunk`, `markUploaded`, `recordSnip`, etc.)
  - Handles crash recovery: scans for `status='pending'` on boot, requeues uploads/transcriptions.
- **`SettingsStore`**
  - Saves user-configurable sliders (pause sensitivity, min/max pause, window length, overlap, bitrate) plus secrets (Groq API key) using OPFS/IndexedDB + in-memory cache.
  - Provides reactive subscription for UI and workers (via BroadcastChannel/message passing).
- **`TelemetryService`**
  - Aggregates metrics (dropped frames, chunks pending, upload latency, VAD stats) and exposes them for UI + optional server logging.
  - Uses `navigator.sendBeacon` or queued POST when online.

### 3. Data Flows
1. **Capture Start**
   - `CaptureController.start()` obtains media stream with `audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}`.
   - Initiates `MediaRecorder` and `AudioContext`. Primary session metadata created (`sessionId`, start time).
2. **Chunk Persistence Loop**
   - On each `MediaRecorder` `dataavailable`, chunk saved to IndexedDB (`status:'pending'`), appended to upload queue, telemetry updated.
   - UI list observes manifest to show session progress.
3. **Analysis Loop**
   - `AudioWorkletProcessor` posts messages with DSP features (every ~20 ms) and candidate boundaries.
   - Main thread consumes proposals, validates with ring buffer tail, writes `snips` records, pokes `TranscriptionWorker` windows.
4. **Upload Cycle**
   - Worker dequeues oldest pending chunk, POSTs with idempotent key `(sessionId, chunkId)`.
   - On success, updates `chunks.status='uploaded'`; otherwise schedules retry (with exponential backoff up to cap + offline detection).
5. **Transcription Cycle**
   - Worker tracks windows; once ready, fetches chunk blobs (from IndexedDB or memory), merges, POSTs to Groq API using stored key.
   - Receives transcription JSON, writes `transcriptionJobs` and `snips` text excerpts; UI consumes incremental updates.

### 4. IndexedDB Schema (Dexie Models)
- `chunks`: `{ id, sessionId, seq, startMs, endMs, blobKey, size, status:'pending'|'uploading'|'uploaded'|'failed', retries, lastError }`
- `snips`: `{ id, sessionId, startMs, endMs, reason:'pause'|'timer', quality:'good'|'ok'|'forced', textPreview?, transcriptionJobId? }`
- `transcriptionJobs`: `{ id, sessionId, snipIds, windowStartMs, windowEndMs, status:'queued'|'running'|'done'|'error', attempt, lastError }`
- `storage`: `{ sessionId, bytesBuffered, bytesUploaded, lastUploadAt, lastSync, warnings: { lowStorage, offline } }`
- `settings`: `{ id:'settings', pauseSensitivity, minPauseMs, maxPauseMs, windowMs, overlapMs, bitrate, groqApiKey }`

### 5. Worker Messaging Contracts
- `AudioWorklet` ⇄ Main: `FeatureFrame`, `SnipProposal`, `Diagnostics`.
- Main ⇄ `UploadWorker`: `EnqueueChunk`, `UploadResult`, `SyncState`, `StorageWarning`.
- Main ⇄ `TranscriptionWorker`: `ScheduleWindow`, `CancelWindow`, `TranscriptionResult`, `TranscriptionError`.
- Settings broadcast via `BroadcastChannel 'app-settings'` for workers to refresh secrets/rules.

### 6. PWA & Build
- Vite + React + TypeScript project at repo root, configured with `vite-plugin-pwa` for offline shell and update flow.
- `build.outDir = 'docs'` to satisfy GitHub Pages hosting requirement.
- Use `src/service-worker.ts` for custom caching (UI shell, worker bundles) while avoiding caching media blobs.
- Ensure `AudioWorklet` scripts served via `registerProcessor` build step (Vite assets). Use dedicated `worklets/` directory.

### 7. UI Composition
- **Main layout**: header with session status (Recording/Uploading/Offline), settings button, buffer health indicator.
- **Recordings list**: cards sorted by `startMs desc`, showing snippet of transcript, status badge, retry button for failed uploads/transcriptions.
- **Live transcription panel**: fixed bottom component with latest 2–3 lines, fading tail, displays recognized text with timestamp badges.
- **Settings drawer**: form for sliders and API key, persisted instantly.
- **Alerts**: permission issues, low storage, offline mode, upload failures.

### 8. Testing Strategy
- **Unit tests (Vitest)**: DSP utilities (RMS/ZCR calculations), hysteresis logic, cadence estimator, manifest operations, upload retry/backoff scheduling.
- **Worklet validation**: run processor logic in node-like harness via `@webaudio/web-audio-api` mock or custom PCM runner.
- **Integration tests**: simulated recording sessions using prerecorded PCM/AAC fixtures streamed through mocks to validate chunking + snip detection + transcription scheduling.
- **End-to-end harness**: optional Playwright script to automate PWA start/stop, offline toggle, and verify manifest resilience.
- **Audio fixtures**: store under `test/fixtures/` with metadata JSON describing sample rate, scenario, and expected outcomes.

### 9. Audio Fixture Requirements
Prepare short (~60 s) AAC files encoded at 48 kHz (Mono) for consistent analysis. Suggested scenarios:
1. **Baseline speech**: normal cadence, minimal background noise.
2. **Fast speech bursts**: rapid utterances with brief pauses.
3. **Background hum**: speech with constant low-frequency noise (AC/fan) to test band-limited RMS.
4. **Speech with music**: moderate background music to ensure VAD tolerance.
5. **Silence & ambient**: silent room with occasional rustle to test false positives.
6. **Overlapping speakers**: two voices taking turns quickly.
7. **Far-field speech**: low SNR scenario.
8. **Offline simulation**: reused baseline sample but annotated for upload-failure tests.
Provide files in `.m4a` (AAC) at 48 kHz, mono. Place in `test/fixtures/audio/` along with `metadata.json` documenting scenario, RMS targets, expected snip count, and transcript snippet for assertions.

### 10. Safeguards & Edge Cases
- Permission revoke → prompt user, auto-stop capture, persist state.
- Device change → attempt seamless rebind; if not possible, stop with recoverable alert.
- Low storage (`navigator.storage.estimate`) → raise warning, pause recording if cap exceeded.
- Page visibility hidden → keep recording but throttle UI updates; warn user about system background limits.
- Network offline → continue buffering, disable transcription requests, show Offline badge.
- Crash/reload recovery → on load, `ManifestService` rebuilds session list, restarts pending uploads/transcriptions, ensures no chunk lost beyond current timeslice.
- Graceful stop → flush ring buffer tail, finalize manifest records (`recording.status='complete'`) once uploads confirmed.

### 11. Open Questions / Next Steps
- Confirm server APIs and authentication (currently assumed open idempotent endpoints).
- Determine encryption or privacy requirements for stored API key and audio data.
- Define telemetry upload endpoints (or keep local-only).
- Validate AAC container compatibility for Groq ingestion (may require conversion server-side).
- After scaffolding, prioritize implementing capture path and IndexedDB/worker communication, followed by DSP logic and UI bindings.
