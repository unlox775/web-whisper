# Web Whisper Architecture (PCM-first)

## 1. System overview
- Goal: capture long-form audio in a PWA, chunk it deterministically, analyze it locally, and transcribe it via Groq without losing audio.
- Design principles:
  - Single capture graph with sample-accurate timing.
  - Immediate persistence to IndexedDB for durability.
  - Analysis and diagnostics derived from stored data, not guesses.
  - Clear separation between capture, storage, analysis, playback, and transcription.

## 2. Runtime modules and responsibilities
- Capture pipeline (`src/modules/capture/controller.ts`)
  - `PcmMp3CaptureController` builds an AudioContext graph and consumes PCM frames.
  - Buffers Int16 blocks until a target sample count is reached, then flushes a chunk.
  - Encodes MP3 with Lame.js and persists chunk metadata + blob.
- MP3 encoder loader (`src/modules/capture/mp3-encoder.ts`)
  - Loads the browser build of `lamejs` and exposes the encoder constructor.
- Storage + manifest (`src/modules/storage/manifest.ts`)
  - IndexedDB schema for sessions, chunks, chunk volume profiles, snips, and logs.
  - Provides verification helpers to rebuild deterministic chunk timings.
- Volume analysis (`src/modules/storage/chunk-volume.ts`)
  - Decodes each chunk to compute normalized volume frames.
- Session analysis (`src/modules/analysis/session-analysis.ts`)
  - Computes quiet regions and segment boundaries from volume frames.
- Analysis provider (`src/modules/analysis/session-analysis-provider.ts`)
  - Verifies chunk timings, concatenates volume profiles, caches analysis results.
- Playback slices (`src/modules/playback/recording-slices.ts`)
  - Provides chunk playback, snip playback, and range decode helpers.
  - Handles legacy MP4 init segments when needed.
- Transcription (`src/modules/transcription/service.ts`)
  - Sends snip audio to Groq Whisper and normalizes response segments.
- Settings (`src/modules/settings/store.ts`)
  - Stores Groq API key, developer mode, bitrate, and storage limit locally.
- Logging (`src/modules/logging/logger.ts`)
  - Persists structured logs per session and exposes them to the UI.
- UI shell (`src/App.tsx`)
  - Orchestrates capture state, list view, detail view, developer tooling, and transcription flows.

## 3. Data flow (happy path)
1. User taps Start: the UI creates a session record and calls `captureController.start`.
2. PCM capture begins via AudioContext + ScriptProcessor; samples are buffered as Int16 blocks.
3. When a chunk threshold is reached, MP3 is encoded and persisted to IndexedDB.
4. A volume profile is computed for each chunk and stored for analysis.
5. The analysis provider builds a full timeline from chunk profiles and proposes snips.
6. Snips are stored and can be played or sent to Groq for transcription.
7. On Stop, the controller flushes remaining PCM, reconciles session totals, and logs results.

## 4. IndexedDB schema (current)
- `sessions`: session metadata, status, duration, and timing verification status.
- `chunks`: per-chunk blobs, start/end timestamps, and verified timing info.
- `chunkVolumes`: normalized volume frames per chunk.
- `snips`: derived segments with optional transcription payload.
- `logSessions` / `logEntries`: structured logging data for debugging.

## 5. Diagnostics and verification
- Log sessions record the capture lifecycle and errors for each run.
- Doctor diagnostics verify chunk coverage, range access, per-chunk decode, and snip scans.
- Timing verification uses volume profile durations to rebuild sequential start/end times.
- Legacy MP4 sessions can be purged via the manifest service if needed.

## 6. Build and deployment
- Vite + React + TypeScript with PWA support.
- `npm run build` outputs static assets to `docs/` for GitHub Pages hosting.

## 7. Planned evolutions
- Move PCM capture from ScriptProcessor to AudioWorklet.
- Add uploader + retry backoff for cloud sync.
- Enforce storage caps and retention policies.
- Extend live transcription for long-running sessions.
