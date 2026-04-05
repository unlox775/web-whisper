# Flows and Parts

This document defines the primary user flows and the major system parts for Web Whisper, using a domain-language style that applies to both product decisions and engineering conversations.

## 1) Ubiquitous language (shared terms)

- **Session**: One recording run from Start to Stop, stored as a durable object.
- **Chunk**: A persisted MP3 segment produced during capture.
- **Snip**: A derived speech segment used for transcription and focused playback.
- **Transcription Preview**: Short list-card text built from snip transcripts.
- **Detail View**: The session drawer where playback, snips, transcription, and diagnostics live.
- **Developer Console**: The in-app debug panel for IndexedDB and logs.
- **Doctor Report**: Diagnostics output for integrity/performance troubleshooting.
- **Retention Pass**: Storage-cap enforcement that can purge chunk/snip audio payloads.

---

## 2) Critical flow (primary value path)

### Critical flow: **Capture a session and obtain usable transcript text**

1. **Open and hydrate the shell.**  
   The user lands on the main app shell and sees capture controls, data usage, and session list state. Front-end work is driven by `App.tsx` startup effects; back-end touchpoints include `manifestService.init`, `settingsStore`, and startup logging milestones.

2. **Start recording.**  
   The user taps Start recording from the capture panel and sees a warm-up/starting state transition into active recording. The front-end dispatches to `captureController.start`, which acquires microphone access and initializes audio graph and chunking state.

3. **Capture and persist chunks continuously.**  
   While recording, UI duration/chunk indicators update and data remains durable even on interruption risk. Back-end modules `captureController`, `manifestService.appendChunk`, and `computeChunkVolumeProfile` persist chunk/audio metadata and analysis-ready volume profiles for every produced chunk.

4. **Stop recording and reconcile session status.**  
   The user taps Stop and expects a complete, replayable session object. The front-end confirms transition back to idle; `captureController.stop` flushes pending data, updates session totals/status via `manifestService.updateSession`, and records lifecycle logs.

5. **Refresh list card and transcript preview state.**  
   The recordings list updates with status, size, duration, and preview text. The front-end list card renderer in `App.tsx` triggers async preview hydration; back-end read path is `manifestService.listSessions` plus `listSnipsForSessions` and transcription preview reduction.

6. **Open session detail and validate playback.**  
   The user opens a session card and expects timeline/playback to work immediately if audio exists. Front-end detail overlay binds to chunk/snip playback controls; back-end slice construction runs through `recordingSlicesApi` and `manifestService.getChunkData`/range decoding.

7. **Run transcription on snips.**  
   The user retries or runs transcription and expects snippets plus aggregate transcript text to appear. Front-end actions call snip transcription handlers; back-end calls `recordingSlicesApi.getRangeAudio`, `transcriptionService.transcribeAudio`, and `manifestService.updateSnipTranscription`.

8. **Copy/use resulting transcript.**  
   The user selects transcript text from detail and uses it externally. Front-end presents consolidated snip transcript text and retry metadata; back-end dependency is primarily persisted snip transcription objects in IndexedDB and related state synchronization.

---

## 3) Secondary flow

### Secondary flow: **Review historical sessions and recover from partial transcription**

1. **Scan session history rapidly.**  
   The user browses many stored sessions in the list and identifies a target by date/duration/status. Front-end relies on list rendering and status pills; back-end reads `sessions` plus preview/snip aggregates from `manifestService`.

2. **Open detail and inspect snip-level outcomes.**  
   The user enters detail mode and checks which snips are transcribed, failed, or purged. Front-end slice mode toggles and snip rows are the main UI; back-end calls `recordingSlicesApi.listSnips` and persisted snip records.

3. **Retry failed snips only.**  
   The user retries failed-but-eligible snips instead of redoing everything. Front-end enables targeted retry actions and progress status; back-end uses transcription service calls and `updateSnipTranscription` patching per snip.

4. **Export/copy corrected transcript.**  
   After retries, the user copies updated full text and continues workflow externally. Front-end text aggregation and copy affordances complete the experience; back-end contribution is normalized snip transcription storage and retrieval consistency.

---

## 4) Tertiary flow

### Tertiary flow: **Debug a startup/performance or data-integrity issue**

1. **Enable developer mode and open debugging surfaces.**  
   The user opens Settings, enables developer mode, and accesses the bug icon panel. Front-end exposes developer UI paths; back-end remains unchanged but debug read paths become available for logs and table inspection.

2. **Inspect storage tables and log sessions.**  
   The user checks table counts/pages and then switches to persisted log sessions for timeline inspection. Front-end uses developer overlay tabs with pagination; back-end calls `getDeveloperTableCounts`, `getDeveloperTablePage`, and `listLogSessions/getLogEntries`.

3. **Run doctor diagnostics in session detail.**  
   The user runs integrity scans and receives summarized findings. Front-end doctor panel orchestrates selected tests and copy/export actions; back-end touches `recordingSlicesApi`, analysis data, and full log retrieval for compact doctor report generation.

4. **Copy compact report into AI chat.**  
   The user exports a copyable report for remote troubleshooting. Front-end provides clipboard/manual-select fallback; back-end provides structured log and diagnostic data from persisted stores suitable for AI-assisted analysis.

---

## 5) Parts catalog

## 5.1 Front-end parts (major components)

### A) App Shell (`src/App.tsx`)
- **Role:** Top-level orchestrator for startup hydration, recording lifecycle UI, list/detail states, settings, and developer overlays.
- **Major subparts:** Header/data card, capture controls, session list, detail overlay, settings dialog, developer console, doctor panel.
- **Main contracts it calls:** `captureController`, `manifestService`, `recordingSlicesApi`, `transcriptionService`, `settingsStore`, logger/startup milestones.

### B) Recording Analysis Graph (`src/components/RecordingAnalysisGraph.tsx`)
- **Role:** Visual histogram/timeline for quiet regions, boundaries, and playback position.
- **Major subparts:** Scrollable SVG graph, threshold/boundary overlays, segment summaries.
- **Main contract:** Receives computed `SessionAnalysis` from the app; no persistence writes.

### C) Settings Dialog (within `App.tsx`)
- **Role:** Configure Groq key, developer mode, and storage cap.
- **Main contracts:** `settingsStore.set/get/subscribe`, `validateGroqApiKey`.

### D) Developer Console (within `App.tsx`)
- **Role:** Inspect IndexedDB rows and persisted log sessions.
- **Main contracts:** `manifestService.getDeveloperTableCounts`, `getDeveloperTablePage`, `listLogSessions`, `getLogEntries`.

### E) Doctor Diagnostics Panel (within detail flow)
- **Role:** Run checks and generate compact troubleshooting reports.
- **Main contracts:** `recordingSlicesApi` inspection methods, `manifestService` reads, logger accessors.

## 5.2 Back-end domain modules (business/use-case modules)

### 1) Capture module (`src/modules/capture/controller.ts`)
- **Owns:** Audio capture lifecycle and MP3 chunk production.
- **Primary contract methods:** `start`, `stop`, `flushPending`, `subscribe`, `getDiagnostics`.
- **Core objects:** Capture state snapshot, chunk sequence/timing, microphone stream/audio graph lifecycle.

### 2) Manifest/storage module (`src/modules/storage/manifest.ts`)
- **Owns:** Durable persistence and indexed access over sessions/chunks/chunkVolumes/snips/logs.
- **Primary contract methods:** `createSession`, `appendChunk`, `listSessions`, `getChunkData`, `listSnips`, `listSnipsForSessions`, `updateSnipTranscription`, `applyRetentionPolicy`, `verifySessionChunkTimings`, developer/log table APIs.
- **Core objects:** `SessionRecord`, `StoredChunk`, `ChunkVolumeProfileRecord`, `SnipRecord`, `LogSessionRecord`, `LogEntryRecord`.

### 3) Analysis provider module (`src/modules/analysis/session-analysis-provider.ts`)
- **Owns:** Timing verification orchestration, volume timeline assembly, analysis caching.
- **Primary contract methods:** `ensureTimings`, `prepareAnalysisForSession`.
- **Core objects:** Verified timing result, frame timeline, computed `SessionAnalysis`.

### 4) Playback slicing module (`src/modules/playback/recording-slices.ts`)
- **Owns:** Chunk and time-range audio extraction for playback/download/transcription.
- **Primary contract methods:** `listChunks`, `listSnips`, `getChunkAudio`, `getRangeAudio`, `inspectRange`, `getSnipAudio`.
- **Core objects:** `RecordingAudioSlice`, range inspection metrics, decoded mono sample slices.

### 5) Transcription module (`src/modules/transcription/service.ts`)
- **Owns:** Groq Whisper integration and result normalization.
- **Primary contract methods:** `transcribeAudio`, `validateGroqApiKey` (exported helper); queue/cancel are placeholders.
- **Core objects:** `TranscriptionAudioRequest/Result`, normalized segment tuples.

### 6) Settings module (`src/modules/settings/store.ts`)
- **Owns:** Local persistent user settings and subscriptions.
- **Primary contract methods:** `get`, `set`, `subscribe`.
- **Core objects:** `RecorderSettings`.

## 5.3 Environmental harnesses (shared plumbing)

These are cross-cutting services that many modules depend on, but they are not user-value flows by themselves:

- **IndexedDB engine (`idb`)**: Physical storage runtime used by manifest service.
- **Browser audio runtime (`getUserMedia`, `AudioContext`, decoding)**: Capture/playback primitives.
- **LocalStorage**: Settings persistence substrate for `settingsStore`.
- **Structured logger + startup milestones**: Session-scoped logging and boot diagnostics (`logger.ts`, `startup-milestones.ts`).
- **Platform network/fetch layer**: Outbound requests for transcription API calls.

---

## 6) Flow-to-parts coverage check

- Critical path touches all core domain modules except upload/telemetry stubs.
- Secondary path emphasizes read-heavy consistency and retry semantics.
- Tertiary path validates observability and debug ergonomics, which are required for reliable AI-assisted maintenance.
- Remaining module stubs (`upload`, `telemetry`) are intentionally outside current critical user value and should remain classified as future/adjacent flows.
