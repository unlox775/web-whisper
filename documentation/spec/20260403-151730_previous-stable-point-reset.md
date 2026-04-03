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

## Status

- ✅ Done: Prompt logged, stable commit identified, rollback branch created/pushed and verified.
- 🚧 In progress: Commit/push documentation updates on working branch.
- ⏭️ Next actions: Stage, commit, and push the spec/prompt logging files.

## Self-evaluation against acceptance criteria

- Branch exists at stable point: Yes (`cursor/pre-ios-and-startup-debug-stable` -> `6f0fca0`)
- Branch pushed to origin: Yes
- Minimal scope/no extra code changes: Yes (documentation logging only on current branch)
