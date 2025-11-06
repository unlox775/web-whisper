# Code Modules and Responsibilities

*Audience: engineers stepping into the codebase. This document lists the most important modules, classes, and functions with short descriptions of what they do and where they are used.*

## 1. Capture Controller (`src/modules/capture/controller.ts`)

| Element | Type | Purpose |
| --- | --- | --- |
| `CaptureController` | interface | Contract for starting/stopping capture, flushing pending writes, attaching analysis ports, and subscribing to state snapshots. |
| `BrowserCaptureController` | class | Concrete implementation that orchestrates `MediaRecorder`, handles chunk events, persists data, and exposes live state. |
| `captureController` | singleton | Exported instance used by the UI (`App.tsx`). |
| `start(options)` | method | Requests microphone access, configures `MediaRecorder`, attaches event listeners, and transitions state to `recording`. |
| `stop()` | method | Flushes trailing chunks, updates session metadata, and resets resources. |
| `#flushRecorder(recorder)` | private method | Issues `requestData()` and waits for the next `dataavailable` event or timeout. |
| `#setState(patch)` | private method | Merges new state and notifies subscribers. |

### Key Event Listeners

- `dataavailable` – handles chunk creation. Calculates duration, logs diagnostics, and persists via `manifestService.appendChunk`.
- `stop` – cleans up media tracks when the recorder stops without an explicit flush.
- `error` – logs failures and surfaces them via controller state.

The controller keeps a promise chain (`#persistQueue`) so chunk writes never overlap, ensuring persistence ordering matches capture ordering.

## 2. Manifest Service (`src/modules/storage/manifest.ts`)

| Element | Type | Purpose |
| --- | --- | --- |
| `SessionRecord` | type | Metadata per recording session (title, start time, status, byte totals, chunk count, duration). |
| `ChunkRecord` / `StoredChunk` | types | Metadata per chunk with `startMs`, `endMs`, `seq`, `byteLength`, etc. `StoredChunk` includes the actual `Blob`. |
| `ManifestService` | interface | Methods for session/chunk CRUD, log storage, and inspection helpers. |
| `IndexedDBManifestService` | class | Implements the interface using the `idb` library. |
| `manifestService` | singleton | Exported instance used throughout the app. |

### Essential Methods

- `init()` – ensures the IndexedDB database is open with the correct schema.
- `createSession(record)` – inserts a new session row when recording starts.
- `appendChunk(entry, blob)` – stores chunk metadata and `Blob`, updates session totals transactionally.
- `updateSession(id, patch)` – merges updates (status, duration, etc.) back into the manifest.
- `getChunkMetadata(sessionId)` / `getChunkData(sessionId)` – read chunk metadata/data for playback or inspection.
- `buildSessionBlob(sessionId, mimeType)` – concatenates header + audio chunks to reconstruct a playable `Blob`.
- Log methods (`createLogSession`, `appendLogEntry`, etc.) power the in-app developer console.

## 3. Logging (`src/modules/logging/logger.ts`)

| Element | Type | Purpose |
| --- | --- | --- |
| `initializeLogger()` | function | Creates a log session in IndexedDB and writes the “logger ready” entry. |
| `logInfo` / `logWarn` / `logError` / `logDebug` | functions | Serialize structured log entries to IndexedDB. Used by the controller, UI, and potential future modules. |
| `getActiveLogSession()` | function | Returns the currently open log session so the UI can highlight live entries. |
| `shutdownLogger()` | function | Marks the active log session as finished (used when the app unmounts). |

Each log entry contains a timestamp, level, message, and optional detail object. The developer overlay in `App.tsx` reads these entries to render human-readable timelines.

## 4. UI Shell (`src/App.tsx`)

| Area | Purpose | Dependencies |
| --- | --- | --- |
| State hooks | Track capture state (`captureState`), session list (`recordings`), playback status, developer overlays, etc. | `captureController`, `manifestService`, `settingsStore`, `logging` |
| `useEffect` subscriptions | Load sessions, subscribe to capture state, manage simulated transcription feed, handle cleanup. | `captureController.subscribe`, `manifestService.listSessions`, `manifestService.getChunkData` |
| Playback helpers | Build playback blobs, toggle play/pause, manage per-chunk preview audio. | `manifestService.buildSessionBlob`, browser `Audio` elements |
| Developer overlay | IndexedDB inspection, log viewer, chunk detail playback. | `manifestService.getChunksForInspection`, logging APIs |
| Settings dialog | Manage developer mode, storage cap, Groq API key. | `settingsStore` |

The UI is intentionally stateful; it normalizes controller state into computed labels (duration strings, metadata text) and drives specialized components (e.g., chunk list). All new logging hooks added to the controller are surfaced through this overlay.

## 5. Settings Store (`src/modules/settings/store.ts`)

| Feature | Purpose |
| --- | --- |
| `settingsStore.get()` | Retrieve persisted settings (developer mode, storage cap, API key, target bitrate). |
| `settingsStore.set(partial)` | Merge updates and persist to `localStorage`. |
| `settingsStore.subscribe(listener)` | Notify subscribers whenever settings change. `App.tsx` uses this to update developer mode UI instantly. |

## 6. Utility Modules

- `src/modules/storage/manifest.ts` also exposes inspection helpers such as `getChunksForInspection()` and `storageTotals()` used in developer tools.
- `src/modules/capture/index.ts` exports the controller; future modules (analysis, upload, transcription) will join this namespace.
- `src/modules/upload/uploader.ts` (placeholder) and `src/modules/transcription/service.ts` (placeholder) exist for future integration; documenting them here signals where the capture pipeline will hand off data next.

## 7. Put It Together

1. UI starts recording → controller handles MediaRecorder → manifest stores metadata.
2. Controller logs every transition → logger writes to IndexedDB → developer overlay renders the timeline.
3. Stop recording → controller flushes → manifest recomputes totals → UI refreshes session list.
4. Playback → UI concatenates stored chunks via manifest → audio element plays the stitch → developer chunk list surfaces per-chunk sizes/durations.

Refer to `capture-flow.md` for a chronological, event-by-event walkthrough, including the new diagnostic log entries and how they map to the modules described above.
