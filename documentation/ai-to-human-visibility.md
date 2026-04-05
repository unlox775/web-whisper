# AI-to-Human Visibility Layer

This document defines a practical visibility strategy for Web Whisper: how humans (and AI assistants) can inspect what the app is doing without guessing, while keeping user-facing behavior clean.

It uses the same ubiquitous language defined in `documentation/flows-and-parts.md`.

## 1) Visibility goals

1. **Tourability:** A human should be able to "walk the factory floor" for a chosen flow and see key transitions and payload shape at each step.
2. **Targeted instrumentation:** Logging should be turnable on/off by module/concern, not all-or-nothing.
3. **Stable persisted evidence:** Logs and object snapshots should survive reloads in session-scoped history.
4. **Low-noise defaults:** Observability should not overwhelm users or flood logs in normal mode.
5. **AI-ready export:** Captured diagnostics should be copyable into AI chat with bounded token footprint.

## 2) Current baseline in this repository

The project already has a strong starting point:

- Structured log sessions persisted in IndexedDB (`logSessions`, `logEntries` via `manifestService`).
- Startup and debug milestones with human-first phrasing (`startup-milestones.ts`).
- Developer overlay (bug icon) with:
  - IndexedDB table browsing (`sessions`, `chunks`, `chunkVolumes`, `snips`)
  - Log session browsing
- Doctor diagnostics export with compact report generation.

What is not yet formalized is **per-module visibility control**, **consistent event schemas per module**, and **flow-oriented log filtering aligned to critical paths**.

## 3) Visibility control model (target)

Define a single runtime config object:

```ts
type VisibilityConfig = {
  enabled: boolean
  level: 'minimal' | 'standard' | 'verbose'
  frontEnd: Record<FrontendPartKey, boolean>
  domainModules: Record<DomainModuleKey, boolean>
  includePayloadSamples: boolean
}
```

### 3.1 Activation

- **Default:** off for normal users.
- **Developer mode on:** visibility controls become available.
- **Per-part/per-module toggles:** allow enabling only relevant modules for a bug.

### 3.2 Non-goals

- Do not inject noisy debug text directly into normal user UI flows.
- Do not block user flows on visibility failures.

## 4) Telemetry contract guidelines

Every instrumented event should include:

- `eventId` (stable string)
- `module` (frontend part or domain module)
- `phase` (`start`, `success`, `error`, `cancel`)
- `sessionId` when available
- `atMs` + `atIso`
- `elapsedMs` for phase duration when relevant
- concise, purpose-driven fields (not full raw payloads unless explicitly sampled)

Avoid generic logs like "method called/returned"; prefer intent-rich events:

- "session-list hydration completed"
- "snip preview batch loaded"
- "retention purged N chunks"

## 5) Module-level telemetry map

Estimated event frequency is for an average app launch + one record interaction. This is used to prevent accidental log-noise explosions.

### 5.1 Front-end telemetry

#### `AppShell` (`src/App.tsx`)
- **Events**
  - `ui.bootstrap.start`
  - `ui.settings.hydrated`
  - `ui.sessionList.visible`
  - `ui.mainSyncBanner.shown/hidden`
- **Expected count**
  - 3-10 per launch.

#### `CaptureControls` (start/stop section)
- **Events**
  - `ui.capture.toggle.clicked`
  - `ui.capture.starting.cancelled`
  - `ui.capture.error.displayed`
- **Expected count**
  - 1-5 per capture attempt.

#### `SessionList`
- **Events**
  - `ui.sessionList.render.start`
  - `ui.sessionList.render.done`
  - `ui.sessionCard.opened`
  - `ui.sessionCard.retryTranscription.clicked`
- **Expected count**
  - 1 render pass + card-level interactions; can grow with pagination.

#### `DetailPanel` + `TranscriptionPanel`
- **Events**
  - `ui.detail.opened`
  - `ui.playback.toggle`
  - `ui.transcription.retryAll.clicked`
  - `ui.snip.transcribe.clicked`
- **Expected count**
  - 10-100 depending on interaction depth.

#### `DeveloperOverlay`
- **Events**
  - `ui.devOverlay.opened`
  - `ui.devOverlay.mode.changed`
  - `ui.devOverlay.table.pageLoaded`
  - `ui.devOverlay.logs.sessionSelected`
- **Expected count**
  - 5-30 per debug session.

### 5.2 Domain-module telemetry

#### `SessionStorage` (`manifestService`)
- **Events**
  - `storage.init.start/done`
  - `storage.sessions.list.start/done`
  - `storage.snips.batchRead.start/done`
  - `storage.retention.run`
  - `storage.verifyTimings.result`
- **Expected count**
  - 5-200 depending on chunk count and preview batching.
- **Payload guidance**
  - Include counts, durations, and status flags.
  - Avoid serializing whole row arrays in normal logging.

#### `CapturePipeline` (`captureController`)
- **Events**
  - `capture.start.requested`
  - `capture.stream.acquired`
  - `capture.chunk.encoded`
  - `capture.chunk.persisted`
  - `capture.stop.completed`
- **Expected count**
  - `chunk.*` scales linearly with recording length (high-frequency class).
- **Payload guidance**
  - Keep per-chunk payload compact (seq, bytes, ms ranges).
  - Sample full diagnostics only on error.

#### `SessionAnalysis` (`SessionAnalysisProvider`, analysis funcs)
- **Events**
  - `analysis.prepare.start/done`
  - `analysis.verifyTimings.triggered`
  - `analysis.snips.generated`
- **Expected count**
  - 1-10 per opened session.

#### `PlaybackSlicing` (`recordingSlicesApi`)
- **Events**
  - `playback.prepareSource.start/done`
  - `playback.range.decode.start/done`
  - `playback.range.decode.error`
- **Expected count**
  - 1-50 per detail session (depends on snip playback).

#### `TranscriptionClient` (`transcriptionService`)
- **Events**
  - `transcription.key.validation.start/done`
  - `transcription.snip.request.start/done/error`
  - `transcription.retry.batch.start/done`
- **Expected count**
  - 1-100 depending on snip count/retries.
- **Payload guidance**
  - Never log API keys.
  - Log response status, latency, snippet length counts.

#### `SettingsStore`
- **Events**
  - `settings.loaded`
  - `settings.updated`
- **Expected count**
  - low (1-10).

#### `AppLogger`
- **Events**
  - `logger.session.started/ended`
  - `logger.write.failed`
  - `logger.globalError.captured`
- **Expected count**
  - low/medium; error spikes indicate issues.

## 6) Persisted object visibility strategy

Humans most often need to inspect raw persisted objects and their lifecycle state. Current/target strategy:

### 6.1 `SessionRecord` visibility
- **Simplified list view:** status, startedAt, duration, chunkCount, totalBytes, timingStatus.
- **Raw view:** full JSON per selected session.
- **Key debugging questions answered**
  - Is session still `recording` unexpectedly?
  - Are duration/bytes/timingStatus coherent?

### 6.2 `ChunkRecord`/`StoredChunk` visibility
- **Simplified list view:** seq, start/end, byteLength, purged flag, blob metadata.
- **Raw view:** JSON with binary omitted marker.
- **Key debugging questions answered**
  - Are timings monotonic?
  - Are purged chunks correctly represented?

### 6.3 `ChunkVolumeProfileRecord` visibility
- **Simplified list view:** frame count, duration, average/max normalized, frames preview.
- **Raw view:** full JSON including frames array.
- **Key debugging questions answered**
  - Do profiles exist for all needed chunks?
  - Are durations inflated or missing?

### 6.4 `SnipRecord` visibility
- **Simplified list view:** index, start/end/duration, transcription present/error, purged status.
- **Raw view:** full JSON including transcription segments.
- **Key debugging questions answered**
  - Why is preview empty?
  - Which snips are retryable?

### 6.5 `LogSessionRecord` + `LogEntryRecord` visibility
- **Simplified list view:** session timestamps and entry counts.
- **Raw view:** selected entry JSON detail.
- **Key debugging questions answered**
  - Which phase consumed time?
  - Which module emitted errors?

## 7) Log viewer behavior expectations

### 7.1 Session model
- Each app run/activation should map to one log session.
- Past sessions must remain selectable.

### 7.2 Filtering
Add filter controls to hide/show by:
- module
- event family (capture/storage/analysis/playback/transcription/ui)
- severity
- phase (`start/success/error`)

This is critical for "I enabled three modules, now hide the noisy one" workflows.

### 7.3 Noise control
- Offer presets: `Minimal`, `CriticalPath`, `Verbose`.
- Throttle repeated high-frequency events (e.g., per chunk) unless verbose mode is on.

## 8) AI-friendly log export model

### 8.1 Copy-first export (required)
- Export selected log session + active filters.
- Include summary header:
  - selected modules
  - time range
  - event counts by severity
- Truncate/summarize large arrays by default.

### 8.2 Retrieval-oriented export (future)
- Optional endpoint/storage integration for secure AI retrieval.
- Not required for current local-only architecture, but design should not block it.

## 9) Flow-driven "factory tour" playbooks

For each main flow, provide a small guided trace sequence:

- **Critical flow tour:** launch -> start capture -> chunk persisted -> stop -> session ready -> open detail -> playback.
- **Secondary flow tour:** open ready session -> load snips -> send snip transcription -> preview refresh.
- **Tertiary flow tour:** developer overlay -> inspect tables -> inspect logs -> export compact report.

These tours should correspond to saved log filters/presets in future implementation.

## 10) Implementation notes for this repository

Existing pieces that already satisfy parts of this document:

- `startup-milestones.ts` human-readable milestone framework.
- `manifestService` persisted log session model.
- developer overlay tables/logs and compact doctor report export.

Gaps to close (planned in `documentation/recommended-refactors.md`):

- centralized visibility registry + per-module toggles
- normalized telemetry event schema
- log filtering by module/event family
- flow-presets for guided debugging
