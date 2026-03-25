# Startup debug milestones (living spec)

- Branch: `main` (reset 2026-03-20 to merge `6f0fca0` = same tree as `cursor/starting-process-interface-5228` @ `9429c33`; iOS/App Store work preserved on `archive/main-with-apple-ios-and-debug-20260320`)
- Started (UTC): 2026-03-14
- Owner intent: Add milestone debug logs at startup and in the debug panel to identify why the web app takes 50s–2min to show the recordings list, and why the debug panel shows "Loading" for ~10s.

## Scope

- Add timestamped milestone logs for: first execution, first load of page, manifest init, listSessions, storageTotals, refreshTranscriptionPreviews (and its per-session listSnips), recordings UI ready.
- Add milestone logs in the developer/debug panel when loading: loadDeveloperTables (sessions, chunks, chunkVolumes, snips) and loadLogSessions.
- Logs must be exportable (existing logger persists to IndexedDB; also emit to console with a consistent prefix so user can export and paste).
- No changes to data purging or storage logic.

## Acceptance criteria

- Milestone logs appear in order during page load with timestamps.
- Milestone logs appear in the debug panel when opening it and loading tables/logs.
- Logs are visible in the debug panel (log session) and exportable for analysis.
- Build succeeds; no functional changes to data handling.

## Plan / todos

- [x] Create startup log utility with timestamps (or use existing logger with a clear prefix).
- [x] Instrument main.tsx first execution.
- [x] Instrument App mount and loadSessions (manifestService.init, listSessions, storageTotals, setRecordings, refreshTranscriptionPreviews).
- [x] Instrument refreshTranscriptionPreviews (per-session listSnips).
- [x] Instrument loadDeveloperTables (sessions, chunks, chunkVolumes, snips).
- [x] Instrument loadLogSessions.
- [x] Ensure logs go to both logger and console with `[startup]` or similar prefix for export.

## Edits log

- 2026-03-20: Git hygiene — archived pre-revert `main` tip (Apple iOS + debug + docs asset bump) as `archive/main-with-apple-ios-and-debug-20260320`. Reset `main` to `6f0fca0` (pre–App Store). Cherry-picked startup milestone commit `6500925` then WIP flush `e893272` onto clean `main`. Regenerated `docs/` for Pages; noted in `documentation/README.md`.
- 2026-03-14: Created spec. Added `src/modules/logging/startup-milestones.ts` with `markStartupMilestone` and `markDebugPanelMilestone` (console + logger via dynamic import). Instrumented: main.tsx (first execution, registerSW); App (mount, initializeLogger, reconcileDanglingSessions, loadSessions, refreshTranscriptionPreviews); manifest getDB open; loadDeveloperTables; loadLogSessions. Logs use `[startup]` prefix and elapsed ms from boot.

## Note

- `npm run build` currently fails on PWA/workbox/terser step (pre-existing); `tsc -b` and app bundle succeed.
