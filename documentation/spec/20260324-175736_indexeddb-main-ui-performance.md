# IndexedDB read paths, main list load, and developer console performance

- **Branch:** `main`
- **Started (UTC):** 2026-03-24
- **Related:** `documentation/spec/20260314-011035_startup-debug-milestones.md` (milestone instrumentation that surfaced the timings discussed below)

## Owner intent

Improve perceived and actual load time for (1) the main recordings screen after app open or returning from detail view, and (2) the developer console (ladybug) overlay. Clarify whether the bottleneck is **stored bytes** vs **number of rows and full-store reads** the UI never needs. Define optional **retention of non-audio data** after chunk audio purge (dead weight vs still required for features).

## Evidence summary (from logs + screenshot, 2026-03-24)

- **`loadSessions` path (historical log, 2026-03-24):** ~15 s between early IndexedDB/session work and list + totals / `setRecordings` on a device with ~126 sessions, ~11.5k chunks/volumes, ~2.9k snips. `refreshTranscriptionPreviews` added ~1 s after that.
- **Developer overlay (before fix):** ~9 s for loading all tables at once, then ~1 s for `loadLogSessions`. Sidebar counts could appear while the detail pane stayed on “Loading…” until both completed.
- **Milestone `+NNNms` values** after long backgrounding are elapsed since first boot in that tab; use **wall-clock deltas** between log timestamps for a single navigation.

## Startup delay — what is still slow and why it was hard to see (2026-03-25)

### The three heavy blocks (still present after A-section work)

Work on **A** removed or narrowed several bad paths (dev overlay `getAll`+`arrayBuffer`, full-chunk totals scan, etc.). The **main list** still does **three large IndexedDB-heavy operations** that can each run **multiple seconds** on a big database:

| Block | Code | Why it hurts |
| --- | --- | --- |
| **1. All snips for previews** | `refreshTranscriptionPreviews` → `manifestService.listSnips()` with **no** `sessionId` → `snips` store **`getAll()`** | Cost scales with **total snip rows** (often 2k+), not “how many cards fit on screen”. Until this finishes, cards can sit on **“Transcription pending…”** even though the session **titles** already rendered. |
| **2. All sessions for the list** | `loadSessions` → `listSessions()` | **Every** session row is read for the sidebar. Scales with session count (~100+). |
| **3. Reconcile “dangling” recordings** | `reconcileDanglingSessions()` (scheduled with **`requestIdleCallback`**, timeout 8s) | **`sessions.getAll()`**, then for each session still **`recording`**, **`chunks` index `getAll(sessionId)`**. Usually few `recording` rows, but the **`sessions` full read** still runs and **runs in parallel** with (1) and (2). |

**Important:** (1)–(3) **overlap in wall time**. IndexedDB is **single-threaded per origin** in practice; concurrent transactions **queue and contend**. So you cannot add “20% + 25% + 30%” from headline `+ms` values and get 75% of a single timeline — the real bottleneck is **which awaits hold the critical path** plus **contention**.

### Why the doctor export still looked confusing

1. **`+NNNms` is not “ms since page load”** — `bootT0` **resets** when the tab becomes visible or on bfcache restore (`resetStartupMilestoneEpoch`). The same export can show **`+8130ms`** on one line and **`+0ms`** on the next **without** meaning the app went backwards in time.

2. **Buffered flush** — milestones logged **before** `flushStartupMilestonesToLogger()` can land in the persisted log with the **same wall-clock time** and **wrong apparent order** relative to true execution order.

3. **Overlapping work** — `loadSessions`, `refreshTranscriptionPreviews`, and `reconcileDanglingSessions` **do not serialize** in one chain. Sorting lines by `+ms` **double-counts** and hides **IDB contention**.

4. **Headline vs payload** — the string **`listSnips done`** alone does not show how long **`await listSnips()`** took. Use the structured fields **`listSnipsMs`** and **`refreshTranscriptionPreviewsMs`** on those milestones (added 2026-03-25) when analyzing exports.

### How to read one boot (practical)

- **Snip read cost:** `refreshTranscriptionPreviews: listSnips done` → **`listSnipsMs`** (dominant part of preview readiness).
- **End-to-end preview pass:** `refreshTranscriptionPreviews: done` → **`refreshTranscriptionPreviewsMs`** (includes grouping + `setState`).
- **Session list read:** wall delta from **`loadSessions: start`** to **`loadSessions: listSessions done`** (payload can add `sessionCount`).
- **Reconcile:** wall delta **`App: reconcileDanglingSessions start`** → **`done`** (often overlaps list + snips).

Percentages are **not** stable across devices (CPU, disk, DB size). Treat the table above as **budget categories**, not fixed ratios.

## Diagnosis (engineering)

1. **Audio purge reduces blob bytes, not row counts.** Retention replaces eligible chunk blobs with empty blobs and marks snips; **chunk rows, snip rows, and chunkVolume rows largely remain.** The app still pays **IndexedDB read/deserialize** and **main-thread work** proportional to those rows whenever code does `getAll()` or full cursors.
2. **Developer console (historical):** `getChunksForInspection()` loaded **all** chunks and called `blob.arrayBuffer()` per row. **Superseded by §A implementation (2026-03-24).**
3. **Full-chunk scan for totals (historical):** `storageTotals()` walked every chunk. **Superseded:** global bytes = sum of **`SessionRecord.totalBytes`** (maintained on append / retention / delete / reconcile).
4. **`listChunkVolumeProfiles()` getAll** for dev overlay only. **Superseded:** paginated `getDeveloperTablePage` when inspecting volumes.
5. **Potential dead weight after audio purge (needs product/technical validation before deleting):**
   - **`chunkVolumes`** for fully **audio-purged** chunks: candidates for optional compaction (**B1/B2**).
   - **Chunk metadata rows:** still required for timeline / integrity.
   - **Snip transcription payloads:** required for UI unless explicit delete policy.
   - **Log stores:** bounded; lower priority.

## Section A — checklist (implemented)

| ID | Item | Status |
| --- | --- | --- |
| **A1** | Dev console: `db.count` per store on open (`getDeveloperTableCounts`) | Done |
| **A2** | Dev console: one table at a time, page size 200 + “Load more”; chunk rows metadata only, no default `arrayBuffer()` (`getDeveloperTablePage`) | Done |
| **A3** | Dev console: overlay open does not await `loadLogSessions`; Logs tab uses `developerLogsLoading` | Done |
| **A4** | Main list: buffer total = **Σ `session.totalBytes`** after `listSessions` (incremental per session on disk) | Done |
| **A5** | Main list: `refreshTranscriptionPreviews` — **one** `listSnips()` (full `snips` `getAll` when no `sessionId`) + group by `sessionId`; avoids N-per-session round-trips but **not** O(sessions)-only work | Done |

### Code references (A)

- `src/modules/storage/manifest.ts` — `DeveloperTableName`, `DeveloperTableCounts`, `getDeveloperTableCounts`, `getDeveloperTablePage`; `storageTotals()` sums sessions; `getChunksForInspection()` pages without per-blob `arrayBuffer`.
- `src/App.tsx` — `loadDeveloperIndexedDbShell`, `loadDeveloperTableFromSidebar`, `appendDeveloperTablePage`; dev UI; `loadSessions` milestone `listSessions+sessionBytesSum done`.
- `src/App.css` — `.dev-table-load-more`.

## Section B — retention / compaction (not started)

| ID | Item | Status |
| --- | --- | --- |
| **B1** | Spike: readers of `chunkVolumes` for purged chunks | Todo |
| **B2** | Optional delete/truncate volume rows on retention + tests | Todo |

## Section C — observability (implemented)

| ID | Item | Status |
| --- | --- | --- |
| **C1** | Finer sub-milestones: `loadSessions` split into `listSessions done`, `sessionBytesSum done`, `before setRecordings`; `refreshTranscriptionPreviews` adds `listSnips done`, `grouped by session`, richer `done`; `[debug]` payloads include `activationMs` | Done |
| **C2** | `resetStartupMilestoneEpoch()` on `visibilitychange` → visible and `pageshow` when `event.persisted` (bfcache); logs `[startup] activation epoch reset (…)` | Done |

### Code references (C)

- `src/modules/logging/startup-milestones.ts` — `resetStartupMilestoneEpoch`; `markDebugPanelMilestone` adds `activationMs`.
- `src/App.tsx` — listeners for visibility / bfcache; extra milestones in `loadSessions` and `refreshTranscriptionPreviews`.

## Acceptance criteria

- **Dev console** on large DB: interactive quickly without loading all chunk blobs or all rows; pagination in place.
- **Main list:** not blocked on full-chunk scan for totals; previews use batched snip read.
- **No regression** on playback, transcription, timing verification, retention, delete-session; purged-audio UX unchanged.
- **B2** automatic deletion: tests + spec note when implemented.

## Plan / todos

- [x] A1–A5 (see table above)
- [ ] B1, B2
- [x] C1, C2

## Edits log

- 2026-03-25: **Spec — startup delay truth table** — documented three dominant blocks (full `snips` getAll, full session list, idle reconcile + IDB contention), why `+NNNms` / buffer flush / overlap obscured costs, and how to use `listSnipsMs` / wall deltas for analysis.
- 2026-03-25: **Transcription preview milestones** — `refreshTranscriptionPreviews` logs `listSnipsMs` (IndexedDB `snips` getAll) and `refreshTranscriptionPreviewsMs` end-to-end so the “Transcription pending…” gap is visible in exports.
- 2026-03-25: **Legacy MP4 removal (continuation)** — MP3/PCM→MP3-only paths: drop `isHeaderSegment` / init UI from `App.tsx`, simplify `recording-slices.ts` (no fMP4 init concat), remove unused `mimeTypeHint` from `#regenerateMissingVolumes`; `tsc` + `npm run build`.
- 2026-03-24: **Section C** — `resetStartupMilestoneEpoch` in `startup-milestones.ts`; visibility + bfcache listeners in `App.tsx`; finer `loadSessions` / `refreshTranscriptionPreviews` milestones; `activationMs` on debug panel logs.
- 2026-03-24: Implemented **recommendation A** (manifest + App + CSS); rebuilt `docs/`; spec converted to checklist + B/C tables.
- 2026-03-24: Expanded `*-PROMPT.txt` with full transcript separators.
- 2026-03-24: Initial spec from owner prompt.

## Self-evaluation vs acceptance criteria

| Criterion | Status |
| --- | --- |
| Dev console architecture | **Improved** — verify on device with large DB |
| Main list totals / previews | **Pass** (session sum + one snip getAll) |
| Core flow regression | **Pending** QA |
| B2 tests | **N/A** until B2 |

## Next actions

- Manual QA: overlay, table switch, load more, Logs tab.
- B1 before any automatic volume purge.
