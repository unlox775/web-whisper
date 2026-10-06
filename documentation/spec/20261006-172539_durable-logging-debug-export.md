# Durable Per-Package Logging & Debug Export

**Branch:** cursor/durable-logging-debug-export-d7b7  
**Status:** 🚧 In progress  
**Created:** 2026-10-06 17:25:39 UTC

## Context

Dave's ~48 min recording hit the 50 MB storage cap, triggering retention purges and a live snip/transcript pipeline stall. When he manually exported the session, logs were missing from the export. This feature adds durable per-package logging with configurable levels and comprehensive debug export capabilities.

See `/home/ubuntu/.cursor/projects/workspace/uploads/FINDINGS_64c6.md` for the full incident diagnosis.

## Acceptance Criteria

### Feature 1: Durable Per-Package Logging
- [✅] Done / [🚧] In progress / [⏭️] Next

**Core Infrastructure:**
- [✅] Extend `LogEntryRecord` schema to include `packageId` field
- [✅] Add log level settings per package (off | error | warn | info | debug)
- [✅] Implement lazy payload evaluation API that gates on level before building expensive payloads
- [✅] Logs persist to IndexedDB and survive tab close
- [✅] Log retention integrated with `applyRetentionPolicy` (age-based, oldest first)
- [✅] Package-scoped logger factory/instances for each module

**Modules to instrument:**
- [✅] capture
- [⏭️] analysis  
- [✅] transcription
- [✅] storage
- [⏭️] settings
- [⏭️] playback
- [⏭️] upload
- [⏭️] telemetry
- [✅] logging/app

**High-value call sites:**
- [✅] Recording start/stop
- [✅] Chunk write
- [✅] Retention pass start/result (including purged counts)
- [✅] Snip/transcript success/fail

**Settings UI:**
- [✅] Advanced settings shows per-package log level controls
- [✅] Display current stored log bytes per package
- [✅] Display total log bytes
- [✅] Mobile-friendly, compact layout

### Feature 2: Export & Debug Dump
- [✅] Session export includes logs scoped to session time window
- [✅] New "Debug dump" action (one-click zip download) containing:
  - [✅] Session metadata
  - [✅] Chunk manifest (with purged markers/sizes)
  - [✅] Snips
  - [✅] Transcripts
  - [✅] Volume profile
  - [✅] Logs (session-scoped)
  - [✅] Settings snapshot (storage limit, per-package log levels)
  - [✅] Storage usage summary
- [✅] Debug dump accessible from Settings/Developer or session detail
- [✅] Clear, non-dev-friendly labels

### Tests
- [⏭️] Level gating: lazy function not called when disabled
- [⏭️] Log persistence round-trip
- [⏭️] Age-based retention frees log bytes under cap
- [⏭️] Export/debug dump includes logs
- [⏭️] No regression in capture performance

### Tests
- [ ] Level gating: lazy function not called when disabled
- [ ] Log persistence round-trip
- [ ] Age-based retention frees log bytes under cap
- [ ] Export/debug dump includes logs
- [ ] No regression in capture performance

## Plan

### Phase 1: Extend logging schema
1. Add `packageId` field to `LogEntryRecord`
2. Add per-package log level settings to `RecorderSettings`
3. Update IndexedDB schema version
4. Add migration logic if needed

### Phase 2: Lazy logger API
1. Create new package-scoped logger class with lazy evaluation
2. Support both eager (string-only) and lazy (function) payloads
3. In-memory level check before calling lazy functions
4. Factory function to create package-scoped loggers

### Phase 3: Log retention
1. Add log byte calculation to storage totals
2. Integrate log cleanup into `applyRetentionPolicy`
3. Age-based deletion (oldest first)
4. Preserve logs for active recording session

### Phase 4: Settings UI
1. Add log level controls per package to Advanced settings
2. Query and display byte counts per package
3. Display total log bytes
4. Ensure mobile-friendly layout

### Phase 5: Instrument modules
1. Create package-scoped logger instances for each module
2. Wire into high-value call sites:
   - Capture: recording start/stop
   - Storage: chunk write, retention start/result
   - Transcription: snip success/fail
   - Analysis: processing outcomes

### Phase 6: Export functionality
1. Add session log query (time-windowed)
2. Create debug dump function:
   - Gather all diagnostic data
   - Package into zip
   - Trigger download
3. Add UI button in appropriate location
4. Update existing session export to include logs

## Technical Design

### Schema Changes

```typescript
// Extended LogEntryRecord
export interface LogEntryRecord {
  id?: number
  sessionId: string
  packageId: string  // NEW: e.g. 'capture', 'analysis', 'transcription'
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  details?: Record<string, unknown>
}

// Extended RecorderSettings
export interface RecorderSettings {
  // ... existing fields
  logLevels: {
    [packageId: string]: 'off' | 'error' | 'warn' | 'info' | 'debug'
  }
}
```

### Lazy Logger API

```typescript
// Package-scoped logger
interface PackageLogger {
  debug(message: string): Promise<void>
  debug(message: string, details: Record<string, unknown>): Promise<void>
  debug(messageFn: () => string): Promise<void>
  debug(detailsFn: () => { message: string; details?: Record<string, unknown> }): Promise<void>
  
  // Same for info, warn, error
}

// Usage examples
const logger = createPackageLogger('capture')

// Eager string (cheap)
await logger.info('Recording started')

// Eager with details
await logger.info('Recording started', { sessionId: 'abc' })

// Lazy (only called if level permits)
await logger.debug(() => ({
  message: 'Large state dump',
  details: { expensive: serializeEverything() }
}))
```

### Retention Strategy

Logs are counted toward the storage limit alongside audio. Retention pass:
1. Calculate total log bytes per package
2. If over limit, delete oldest log entries first (by timestamp)
3. Never delete logs from the currently active recording session
4. Integrate into existing `applyRetentionPolicy` transaction

### Export Format

**Session Export (existing, enhanced):**
- Add `logs.json` containing all log entries within session time window

**Debug Dump (new):**
```
debug-dump-{sessionId}.zip
├── manifest.json          (session metadata + chunk records)
├── snips.json            (all snips)
├── transcripts.json      (all transcripts)
├── volume-profile.json   (if present)
├── logs.json             (session-scoped logs)
├── settings.json         (storage limit, log levels)
└── storage-summary.json  (totals by table)
```

## Changes

### Files Created
- `src/modules/logging/package-logger.ts` — Package-scoped logger with lazy evaluation
- `src/modules/export/debug-dump.ts` — Export and debug dump functionality

### Files Modified
- `src/modules/storage/manifest.ts`
  - Updated DB schema to v5, added `packageId` to LogEntryRecord
  - Added `by-package` index on logEntries
  - Added `getLogEntriesInTimeRange`, `getLogStorageByPackage`, `purgeOldLogs` methods
  - Integrated log purging into `applyRetentionPolicy`
  - Added storage logger and logging for retention passes and chunk writes
- `src/modules/settings/store.ts`
  - Added `LogLevel` type export
  - Added `logLevels` field to `RecorderSettings`
  - Updated defaults with per-package log levels
- `src/modules/logging/logger.ts`
  - Integrated with package logger
  - Updated `initializeLogger` and `shutdownLogger` to manage package logger sessions
  - Updated `log` function to include packageId
- `src/modules/capture/controller.ts`
  - Added capture logger
  - Added logging for recording start/stop
- `src/modules/transcription/service.ts`
  - Added transcription logger
  - Added logging for transcription success/fail
- `src/App.tsx`
  - Added state and handlers for log storage display
  - Added log level controls in Settings (developer mode)
  - Added debug dump button in Doctor diagnostics section
  - Display per-package log storage bytes and counts

## Testing

### Manual Verification
1. Open Advanced settings → verify per-package log level controls visible
2. Change log level for a package, trigger activity, verify logs appear/don't appear
3. Check byte counts update as logs are written
4. Fill storage, trigger retention, verify old logs purged
5. Create a session, open debug dump → verify all data present in zip
6. Verify debug dump includes logs matching session time window

### Automated Tests
- (TBD)

## Follow-up / Future Work
- Consider log streaming/export to external services
- Add log search/filter UI in developer panel
- Structured log viewer (instead of raw JSON)

---

## Changelog

### 2026-10-06 17:25 UTC — Initial spec
- Created spec and prompt log files
- Documented acceptance criteria and technical design

### 2026-10-06 18:00 UTC — Core implementation complete
- Extended IndexedDB schema (v5) with packageId and by-package index
- Implemented package-scoped logger with lazy evaluation
- Added log retention (age-based, integrated into applyRetentionPolicy)
- Wired loggers into capture, storage, and transcription modules
- Created export/debug dump module with session export and debug dump functions
- Build is green (npm run build succeeds)
- Next: Add UI for log level settings and debug dump buttons

### 2026-10-06 19:30 UTC — UI implementation complete
- Added log level controls per package in Advanced Settings
- Added per-package log storage byte counts and total in settings
- Added "Debug dump" button in Doctor diagnostics section
- Settings UI polls log storage every 10 seconds for live updates
- Build is green
- Ready for manual testing and PR
