# Storage retention policy (branch: cursor/storage-retention-policy-de1c)

## 🧭 Plan
1. Confirm storage retention logic purges only transcribed snip audio and preserves metadata.
2. Ensure UI blocks playback/download/transcription retries for purged audio and explains why.
3. Run retention on a debounced cadence during recording and keep totals updated.
4. Trigger retention when storage limits change and when chunks span multiple snips.
5. Update docs/specs and self-evaluate against acceptance criteria.

## ✅ Acceptance criteria
- Retention runs on a debounced cadence during recording (no more than once every 2 minutes) and keeps storage under the cap.
- Only chunk audio for fully transcribed snips is deleted; metadata remains.
- UI blocks transcription retries for purged snips and explains that audio was removed.
- Retention runs when the storage cap is changed and handles chunks spanning multiple transcribed snips.

## ✅ Done
- Implemented retention pass that purges oldest chunk audio covered by fully transcribed snips and updates session totals.
- Added purged markers on chunks/snips and blocked playback/download/transcription for purged audio.
- Scheduled retention every 2 minutes during recording and updated buffer totals.
- Triggered retention when storage limits change to purge without needing an active recording.
- Updated eligibility to allow chunks spanning multiple transcribed snips (while blocking any with untranscribed overlaps).
- Logged per-branch spec guidance and relocated prompts into this branch log.
- Disabled session-level retry when only purged snips remain and added purge messaging in session list previews.

## 🧾 Edits (what/where/why)
- `src/modules/storage/manifest.ts`: added `audioPurgedAt` markers and retention pass to remove eligible chunk blobs while preserving metadata.
- `src/modules/storage/manifest.ts`: widened purge eligibility to support chunks spanning multiple transcribed snips.
- `src/App.tsx`: gated retries/playback/download on purged audio, surfaced purge notes, and scheduled retention runs during recording.
- `src/App.tsx`: added forced retention pass when storage limit changes.
- `src/App.tsx`: extended session list counts to hide retry actions when all snips are purged.
- `src/App.css`: added styling for purged snip/chunk indicators and retention notices.
- `AGENTS.md`: documented per-branch spec rule and spec content requirements.
- `documentation/spec/20260124-183404_final-polish-roadmap-PROMPT.txt`: cleaned up legacy prompt log (relocated prompts).
- `documentation/spec/20260125-071411_storage-retention-policy-de1c*`: established branch-specific spec + prompt log.

## ✅/🚧 Todos
- ✅ Verify retention cadence is debounced to 2 minutes during recording.
- ✅ Ensure purge markers block retries/playback/download and display explanations.
- ✅ Validate session list retry UI is disabled when all snips are purged and add an explicit purge message.
- ✅ Run retention on storage cap changes and allow multi-snip chunk purge.

## 🔍 Self-evaluation
- Debounced retention cadence: **Pass** (2-minute interval while recording).
- Purge only fully transcribed snip audio: **Pass** (eligibility requires transcription and full coverage).
- UI blocks retries & explains purge: **Pass** (snip/detail views explain and session list blocks retry with purge messaging).
- Storage-limit change handling + multi-snip chunks: **Pass** (forced pass on settings change and overlap-aware eligibility).

## ⏭️ Next actions
- None.
