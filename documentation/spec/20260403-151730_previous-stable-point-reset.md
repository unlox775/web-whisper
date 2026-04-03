# Previous stable point reset (living spec)

- Branch: `cursor/previous-stable-point-bbf1`
- Started (UTC): 2026-04-03 15:17:30
- Owner intent: Create a branch pointer at the stable commit before both (1) App Store/iOS preparation work and (2) subsequent startup/performance debugging work.

## Planning notes

- Candidate stable commit identified from history: `6f0fca0` ("Merge pull request #23 from unlox775/cursor/starting-process-interface-5228").
- This commit predates:
  - App Store/iOS preparation lineage (e.g., `0a12a2f` and descendants on archived path).
  - Startup/performance investigation commits on main (`1bd58e5` onward, including IndexedDB/debug milestone updates).
- Action: create a dedicated branch from `6f0fca0` and push it for safe rollback/testing.

## Acceptance criteria

- A branch exists that points at `6f0fca0` (stable point before both bodies of work).
- Branch is pushed to `origin` so it is available remotely.
- Working tree remains otherwise untouched beyond documentation logging.

## Todos

- [x] Locate stable commit boundary before both work streams.
- [x] Append latest user request to active branch prompt log.
- [x] Create and push rollback branch at `6f0fca0`.
- [x] Verify branch SHA and report exact branch/commit.
- [x] Append follow-up user prompt requesting commit/push to prompt log.

## Edits log

- 2026-04-03 15:17:30 UTC: Created branch-specific spec/prompt pair for rollback request on `cursor/previous-stable-point-bbf1`.
- 2026-04-03 15:17:30 UTC: Confirmed rollback target commit `6f0fca0` from git history.
- 2026-04-03 15:18 UTC: Created and pushed `cursor/pre-ios-and-startup-debug-stable` at `6f0fca0`; verified SHA match.
- 2026-04-03 15:19:57 UTC: Appended follow-up user prompt ("Reminder to commit and push if appropriate.") to prompt log.
- 2026-04-03 15:42:19 UTC: Appended user request for startup/data-flow walkthrough with clickable stable-branch links; added exhaustive code tour and performance/telemetry assessment (docs-only).

## Status

- ✅ Done: Prompt logged, stable commit identified, rollback branch created/pushed and verified, and startup/data-flow walkthrough documented with clickable links.
- 🚧 In progress: Commit/push latest documentation updates on working branch.
- ⏭️ Next actions: Stage, commit, and push the updated spec/prompt logging files.

## Self-evaluation against acceptance criteria

- Branch exists at stable point: Yes (`cursor/pre-ios-and-startup-debug-stable` -> `6f0fca0`)
- Branch pushed to origin: Yes
- Minimal scope/no extra code changes: Yes (documentation logging only on current branch)

---

## Follow-up tour: startup + data pull walkthrough (no code changes)

- Requested focus branch for code links: [`cursor/pre-ios-and-startup-debug-stable`](https://github.com/unlox775/web-whisper/tree/cursor/pre-ios-and-startup-debug-stable)
- This section is a source-code tour only (no runtime/code edits).

### 1) What runs first on startup

1. **Earliest startup file (entrypoint):** `src/main.tsx`
   - File: [`src/main.tsx`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/main.tsx)
   - Earliest executable line in that file: `document.title = 'Web Whisper'` at [`L7`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/main.tsx#L7)
   - Service worker registration: [`L9`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/main.tsx#L9)
   - React root mount (`<App />`): [`L11-L14`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/main.tsx#L11-L14)

2. **Earliest React component code (App function):**
   - `function App()` starts at [`src/App.tsx#L314`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L314)
   - Earliest App JSX return begins at [`src/App.tsx#L3760`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3760)

3. **Earliest startup data-triggering hooks in App:**
   - Settings subscription (localStorage-backed settings store): [`src/App.tsx#L773`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L773)
   - Logger init: [`src/App.tsx#L782-L787`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L782-L787)
   - Wake lock init: [`src/App.tsx#L789-L791`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L789-L791)
   - Dangling session reconcile: [`src/App.tsx#L793-L795`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L793-L795)
   - **Main data load kickoff (`loadSessions`)**: [`src/App.tsx#L872-L874`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L872-L874)

4. **First IndexedDB open path:**
   - `manifestService.init()` in `loadSessions`: [`src/App.tsx#L657-L661`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L657-L661)
   - `init()` calls `getDB()`: [`src/modules/storage/manifest.ts#L309-L310`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L309-L310)
   - `getDB()` opens IndexedDB via `openDB(...)`: [`src/modules/storage/manifest.ts#L240-L273`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L240-L273)

---

### 2) Data branch A: top-left storage tile ("Data used / quota")

#### A1. Where it first gets populated

- UI tile render:
  - Buffer card + label/value: [`src/App.tsx#L3771-L3774`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3771-L3774)
- Value source:
  - `bufferLabel` derived from `bufferTotals`: [`src/App.tsx#L3618`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3618)
- Initial state default:
  - `bufferTotals` initialized with `0 / DEFAULT_STORAGE_LIMIT_BYTES`: [`src/App.tsx#L329-L332`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L329-L332)

#### A2. Startup lookup path for bytes + quota

- Startup loader fetches sessions + totals together:
  - `Promise.all([ listSessions(), storageTotals() ])`: [`src/App.tsx#L666-L669`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L666-L669)
- Result is applied to tile state:
  - `setBufferTotals({ totalBytes: totals.totalBytes, limitBytes: storageLimitBytes })`: [`src/App.tsx#L695`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L695)
- `storageLimitBytes` source:
  - from settings (`settings?.storageLimitBytes`): [`src/App.tsx#L432`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L432)
  - settings are localStorage-backed via settings store subscribe: [`src/App.tsx#L773`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L773), [`src/modules/settings/store.ts#L45-L62`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/settings/store.ts#L45-L62)

#### A3. How totals are computed (deep dive)

- `manifestService.storageTotals()` implementation:
  - starts: [`src/modules/storage/manifest.ts#L600`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L600)
  - opens a cursor on **all chunk rows**: [`src/modules/storage/manifest.ts#L602-L605`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L602-L605)
  - sums `cursor.value.byteLength` for each row: [`src/modules/storage/manifest.ts#L606-L608`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L606-L608)
- Interpretation:
  - Startup storage tile bytes are computed from a full chunks-store scan, not a precomputed aggregate.

---

### 3) Data branch B: recordings list (main screen)

#### B1. Where list query starts

- Load effect (on mount): [`src/App.tsx#L872-L874`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L872-L874)
- Loader function:
  - `loadSessions` starts: [`src/App.tsx#L657`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L657)
  - fetches sessions via `manifestService.listSessions()`: [`src/App.tsx#L667`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L667)
- Storage impl for list:
  - `listSessions()` uses `db.getAll('sessions')`: [`src/modules/storage/manifest.ts#L374-L383`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L374-L383)
- Applied to UI state:
  - `setRecordings(sessions)`: [`src/App.tsx#L693`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L693)

#### B2. Where each tile gets extra data (deep dive)

- Main list render maps **all recordings** in state:
  - `recordings.map(...)`: [`src/App.tsx#L3974`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3974)
  - each tile reads preview/count dictionaries in memory (`transcriptionPreviews`, `transcriptionSnipCounts`, etc.): [`src/App.tsx#L3979-L3988`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3979-L3988)

- Preview data for list is fetched in background right after `setRecordings`:
  - `void refreshTranscriptionPreviews(sessions)`: [`src/App.tsx#L696`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L696)
  - `refreshTranscriptionPreviews` loops sessions and for ready sessions calls `manifestService.listSnips(session.id)`: [`src/App.tsx#L607-L627`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L607-L627)
  - in manifest, `listSnips(sessionId)` uses index `by-session` + `getAll(sessionId)`: [`src/modules/storage/manifest.ts#L484-L500`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L484-L500)

- Direct answer to your virtualization question:
  - **No virtualization in this branch.** The list renders with `recordings.map(...)` for all loaded sessions.
  - Preview fetches run per ready session in `Promise.all`, regardless of scroll visibility.

#### B3. What happens when you open a specific recording tile

- Click tile selects ID:
  - `onClick={() => setSelectedRecordingId(session.id)}`: [`src/App.tsx#L4045`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L4045)
- Selection effect performs detail data reads:
  - effect starts: [`src/App.tsx#L950-L977`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L950-L977)
  - pulls `getChunkData(selectedRecordingId)` + `listSnips(selectedRecordingId)` in parallel: [`src/App.tsx#L965-L968`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L965-L968)
- Storage detail methods:
  - `getChunkData(sessionId)` -> index `by-session` + `getAll`: [`src/modules/storage/manifest.ts#L409-L419`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L409-L419)
  - `listSnips(sessionId)` path above: [`src/modules/storage/manifest.ts#L484-L500`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L484-L500)

---

### 4) Data branch C: debugger panel (developer overlay)

#### C1. First call when opening debugger panel

- Debugger button:
  - bug button calls `handleOpenDeveloperOverlay`: [`src/App.tsx#L3775-L3783`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3775-L3783)
- Open handler:
  - starts loader + overlay state: [`src/App.tsx#L3599-L3603`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3599-L3603)
  - then `await loadDeveloperTables()` first: [`src/App.tsx#L3604`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3604)
  - then `await loadLogSessions()`: [`src/App.tsx#L3605`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3605)

#### C2. What `loadDeveloperTables()` actually pulls

- Function:
  - [`src/App.tsx#L3517-L3554`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3517-L3554)
- It does **all four table fetches concurrently**, then stores full row arrays in React state:
  - `listSessions()`: [`src/App.tsx#L3520`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3520) -> [`manifest.ts#L374-L383`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L374-L383)
  - `getChunksForInspection()`: [`src/App.tsx#L3521`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3521) -> [`manifest.ts#L1074-L1105`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L1074-L1105)
  - `listChunkVolumeProfiles()` (no session arg): [`src/App.tsx#L3522`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3522) -> [`manifest.ts#L463-L482`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L463-L482)
  - `listSnips()` (no session arg): [`src/App.tsx#L3523`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3523) -> [`manifest.ts#L484-L500`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L484-L500)

- Important deep detail:
  - `getChunksForInspection()` does a full `chunks.getAll()` **and** reads each chunk blob via `blob.arrayBuffer()` for verification: [`manifest.ts#L1076-L1089`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L1076-L1089)
  - So yes, on this branch, debugger open is heavy and loads large in-memory payloads.

#### C3. Counts: are they cheap counts or full loads?

- In this branch, table "counts" shown in sidebar are `table.rows.length`:
  - render of count badge: [`src/App.tsx#L5245`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L5245)
- There is **no separate `count()` query** path in this debugger implementation; counts are derived after full table loads.

#### C4. When clicking Logs or a table

- Toolbar buttons:
  - IndexedDB tab triggers `loadDeveloperTables()` again: [`src/App.tsx#L5213-L5218`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L5213-L5218)
  - Logs tab triggers `loadLogSessions()`: [`src/App.tsx#L5224-L5229`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L5224-L5229)
- Log loading internals:
  - `loadLogSessions`: [`src/App.tsx#L3569-L3584`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L3569-L3584)
  - `listLogSessions()` is full getAll of logSessions: [`manifest.ts#L1152-L1156`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L1152-L1156)
  - then `getLogEntries(sessionId, limit=250)` cursor (bounded): [`manifest.ts#L1158-L1166`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/modules/storage/manifest.ts#L1158-L1166)
- Clicking a specific table button in IndexedDB mode:
  - only sets selected table name in state (`setSelectedDeveloperTable(table.name)`): [`src/App.tsx#L5242`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L5242)
  - no extra DB call there; rows were already loaded.
- Row rendering itself:
  - full map over active table rows + `JSON.stringify` per row: [`src/App.tsx#L5256-L5311`](https://github.com/unlox775/web-whisper/blob/cursor/pre-ios-and-startup-debug-stable/src/App.tsx#L5256-L5311)

---

### 5) Assessment: best opportunities to speed startup (on this branch)

1. **Storage tile total-bytes scan is O(all chunks) on startup**
   - Current path: `storageTotals()` cursor across all chunks.
   - Opportunity: maintain and trust a per-session aggregate (`SessionRecord.totalBytes`) and compute global total from sessions only.

2. **Main list preview hydration fetches snips per ready session eagerly**
   - Current path: `refreshTranscriptionPreviews()` does `listSnips(session.id)` for all ready sessions, regardless of viewport.
   - Opportunity: lazy/incremental preview hydration (first visible N cards, then background batches), or denormalize preview text/counts into session rows.

3. **No list virtualization**
   - Current path: `recordings.map(...)` for all sessions.
   - Opportunity: windowing/virtual list for card rendering to reduce initial render + reconciliation cost.

4. **Developer overlay does heavyweight full-store reads**
   - Current path: loads sessions/chunks/chunkVolumes/snips fully on open; chunks path even reads blob bytes.
   - Opportunity: cheap `count()` metadata first, then on-demand paged reads for selected table only.

5. **Developer table counts are derived from loaded rows**
   - Current path: count badge uses `rows.length` after full load.
   - Opportunity: indexed DB `count()` per store for instant counts without materializing rows.

6. **Detail panel data is all-at-once per selected recording**
   - Current path: `getChunkData` + `listSnips` full for selected session.
   - Opportunity: progressive detail loading (metadata first, chunk/snip pagination for deep/doctor panes).

---

### 6) Telemetry insertion map (to quantify gains)

Add timestamps/metrics at these choke points (without changing behavior first):

1. **Boot envelope**
   - `main.tsx` before SW registration, after SW registration, before React render, after first App mount effect.

2. **`loadSessions` split**
   - before/after `manifestService.init()`
   - before/after `purgeLegacyMp4Sessions()`
   - before/after `listSessions()`
   - before/after `storageTotals()`
   - before `setRecordings`, after first paint with list shell.

3. **Preview hydration**
   - per-session `listSnips(session.id)` duration + row count
   - total preview pass duration
   - time to first non-empty preview text for visible cards.

4. **Render pressure**
   - number of session cards rendered on first pass
   - time from `setRecordings` to commit of first list paint.

5. **Developer overlay**
   - open click -> overlay visible
   - `loadDeveloperTables` total and per-store durations/row counts
   - for chunks: time spent in blob `arrayBuffer()` verification loop
   - `loadLogSessions` and `getLogEntries` timings.

6. **Detail view**
   - select tile -> detail shell visible
   - `getChunkData` duration + rows
   - `listSnips(selectedRecordingId)` duration + rows.

---

## Follow-up todo items (analysis-only phase)

- [x] Produce clickable startup/data-flow map to stable branch source lines.
- [x] Answer whether list/debug views load all data vs viewport-only data.
- [x] Identify highest-value startup speed opportunities without code changes.
- [x] Provide explicit telemetry insertion points to measure baseline and gains.
