# IndexedDB read paths, main list load, and developer console performance

- **Branch:** `main`
- **Started (UTC):** 2026-03-24
- **Related:** `documentation/spec/20260314-011035_startup-debug-milestones.md` (milestone instrumentation that surfaced the timings discussed below)

## Owner intent

Improve perceived and actual load time for (1) the main recordings screen after app open or returning from detail view, and (2) the developer console (ladybug) overlay. Clarify whether the bottleneck is **stored bytes** vs **number of rows and full-store reads** the UI never needs. Define optional **retention of non-audio data** after chunk audio purge (dead weight vs still required for features).

## Evidence summary (from logs + screenshot, 2026-03-24)

- **`loadSessions` path:** ~15 s between `purgeLegacyMp4 done` and `listSessions+storageTotals done` / `setRecordings` on a device with ~126 sessions, ~11.5k chunks/volumes, ~2.9k snips. `refreshTranscriptionPreviews` added ~1 s after that.
- **Developer overlay:** ~9 s for `loadDeveloperTables` (`Promise.all` of sessions + chunks + chunkVolumes + snips), then ~1 s for `loadLogSessions`. Sidebar counts can appear while the detail pane stays on “Loading…” until both complete.
- **Milestone `+NNNms` values** after long backgrounding are elapsed since first boot in that tab; use **wall-clock deltas** between log timestamps for a single navigation.

## Diagnosis (engineering)

1. **Audio purge reduces blob bytes, not row counts.** Retention replaces eligible chunk blobs with empty blobs and marks snips; **chunk rows, snip rows, and chunkVolume rows largely remain.** The app still pays **IndexedDB read/deserialize** and **main-thread work** proportional to those rows whenever code does `getAll()` or full cursors.
2. **Developer console is especially expensive by design today:** `getChunksForInspection()` loads **all** chunks from the `chunks` store and, for **each** row, calls `blob.arrayBuffer()` to verify size—even though the UI replaces the blob with `"[binary omitted]"`. That is unnecessary work for a debugger grid and scales with chunk count (~11k).
3. **`storageTotals()`** walks **every** chunk record to sum `byteLength` on each cold load path that runs with `listSessions()`. With many small rows this is O(chunks) IDB reads every time.
4. **`listChunkVolumeProfiles()`** without `sessionId` loads **all** volume profiles (large `frames` arrays) for the dev overlay only; not needed for the main list.
5. **Potential dead weight after audio purge (needs product/technical validation before deleting):**
   - **`chunkVolumes`** for chunks that are fully **audio-purged** (`byteLength === 0` / `audioPurgedAt` on chunk): volume profiles exist for analysis/visualization derived from audio. If the product no longer shows per-chunk histograms for purged audio and timing is already **verified** on chunks/session, these records may be **candidates for deletion** on purge (or a lazy “compact” job) to shrink DB size and future read costs. **Risk:** any code path that still expects volume data for purged chunks (e.g. regen timing, debug views, future features) must be checked first.
   - **Chunk metadata rows** (without blob payload): generally **still required** for timeline, seq, verified duration, and session integrity—not “dead” even when blob is empty.
   - **Snip transcription payloads:** needed for list/detail UI; not dead weight unless the user explicitly deletes sessions or we add a policy to drop text for old sessions.
   - **Log stores:** already bounded (`MAX_LOG_SESSIONS`); lower priority.

## Recommendations (ordered roughly by impact vs risk)

### A. Stop doing unbounded full-store work for UI that does not need it

1. **Developer console – lazy / scoped loads**
   - Do **not** call `getChunksForInspection()` as implemented today on open. Replace with: **counts only** on first paint (cheap `count` queries or cached counts if IDB API limits require), then load **one** table’s rows when the user selects that table, with **pagination** (e.g. first 200 rows, “load more”).
   - For chunk rows in dev UI: return **metadata only** (strip blob from projection in a new helper, e.g. `getChunkRowsForDevPage(cursor, limit)`), and **drop** per-row `arrayBuffer()` unless a dedicated “verify blob” action is clicked.
2. **Developer console – split overlay loading**
   - Load **IndexedDB tab** data and **Logs tab** data independently so opening the overlay does not block the whole modal on `loadLogSessions` if the user only cares about tables (or vice versa).
3. **Main list – `storageTotals`**
   - **Option 1 (preferred long-term):** maintain **incremental totals** (global and per-session) updated on chunk append/purge/delete; `loadSessions` reads O(1) or O(sessions) summary only.
   - **Option 2 (shorter):** defer `storageTotals` until after first paint of the list (show list from `listSessions` only, then fill buffer meter), or run totals in `requestIdleCallback` where supported.
4. **Main list – `refreshTranscriptionPreviews`**
   - Audit what data each session preview needs; avoid **per-session** full `listSnips` if a denormalized preview on `SessionRecord` or a capped query suffices. Consider **lazy** preview fetch for off-screen rows (virtualized list) in a later iteration.

### B. Retention / compaction (after audio purge)

5. **Optional compaction pass:** when retention clears a chunk’s audio, **evaluate deleting** the matching **`chunkVolumes`** row for that `chunkId` if timing is verified and no feature requires the volume profile for purged audio. Gate behind tests and explicit checks for `verifySessionChunkTimings` / playback / analysis callers.
6. **User-facing “compact database” (optional):** one-shot maintenance that drops dev-only-relevant bulk or runs migrations; only if we need a safety valve before automatic deletion.

### C. Observability

7. **Extend milestones** (or reuse existing): sub-milestones inside `listSessions`, `storageTotals`, and `refreshTranscriptionPreviews` (e.g. snip list duration per session or batch) so the next export pinpoints remaining hotspots after refactors.
8. **Reset or segment boot clock** on visibility resume if we want `+ms` to reflect “this activation” rather than tab lifetime (separate small UX/logging change).

## Acceptance criteria

- Opening the **developer console** on a large DB (10k+ chunks) reaches interactive table UI in **under ~2 s** on mid-tier mobile, **without** loading full chunk blobs or all snip/transcription bodies until the user asks (pagination or table selection).
- **Main list** becomes visible within a **target** agreed after baseline (e.g. under 5 s on the same device class) without waiting for **optional** work (totals, off-screen previews), or totals complete in **background** without blocking `setRecordings`.
- No regression: **playback, transcription, timing verification, retention, and delete-session** flows still behave correctly; purged-audio UX unchanged unless explicitly redesigned.
- Any **automatic deletion** of `chunkVolumes` (or similar) is covered by **tests** and documented in this spec’s Done section.

## Plan / todos

- [ ] **A1:** Replace dev-overlay chunk load path: metadata-only / paginated API; remove bulk `arrayBuffer()` from default open path (`manifest.ts` + `App.tsx`).
- [ ] **A2:** Lazy-load dev tables per selected store; show counts in sidebar without `getAll` for every store on open.
- [ ] **A3:** Decouple `loadLogSessions` from blocking IndexedDB tab (parallel tabs or defer logs until Logs tab selected).
- [ ] **A4:** Design and implement **incremental storage totals** (or deferred totals) and wire `loadSessions` accordingly.
- [ ] **A5:** Profile `refreshTranscriptionPreviews`; reduce redundant `listSnips` / consider session-level preview cache or lazy load.
- [ ] **B1:** Spike: list all readers of `chunkVolumes` / volume profiles for **purged** chunks; decision doc in this spec (keep vs delete on purge).
- [ ] **B2:** If approved, implement volume row deletion (or truncation) on retention for eligible chunks + migration/tests.
- [ ] **C1:** Add or tighten milestone timings for sub-phases post-refactor.

## Edits log

- 2026-03-24: Expanded `*-PROMPT.txt` to full conversation transcript (git/main/iOS recovery, `git log` question, Doctor Report + timing question, spec request, prompt-log correction) separated by `---`.
- 2026-03-24: Created spec from owner prompt; captured log-derived timings, `getChunksForInspection` / `storageTotals` / dev-overlay analysis, and retention dead-weight notes.

## Self-evaluation vs acceptance criteria

| Criterion | Status |
| --- | --- |
| Dev console fast on large DB | **Pending** (no code changes yet) |
| Main list not blocked on non-critical work | **Pending** |
| No regression on core flows | **Pending** (must verify per change) |
| Deletion/compaction tested | **N/A** until B2 implemented |

## Next actions

- Implement **A1–A3** first (highest confidence, directly matches observed ~9 s dev load).
- Parallel **A4** spike (where totals time appears in traces).
- **B1** before any automatic volume purge.
