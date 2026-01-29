# Starting process interface fixes

- Branch: cursor/starting-process-interface-5228
- Date started: 2026-01-29

## Planning notes
- Review capture/starting UI states and timeout handling.
- Add early cancel affordance and progressive feedback before timeout.
- Wire cancel icons during starting to cancel action.
- Hide delete actions during active recording.

## Todos
- [x] Inspect current starting/recording UI logic and timers.
- [x] Implement early cancel link + progressive cues while starting.
- [x] Replace starting trash actions with cancel and hide during recording.
- [x] Run npm install + npm run build, commit artifacts, and push.

## Acceptance criteria
- Starting state shows an early cancel affordance after a short delay.
- Starting state provides progressive cues before the 15s timeout.
- Cancel icons during starting trigger cancel behavior, not delete.
- Delete/trash actions are hidden while a recording is active.

## Changes
### ✅ Done
- Added a starting-state cancel hint and progressive cue timer for stalled starts.
- Added softer pre-timeout flash pulses and a triple-beep cue pattern.
- Replaced starting-state trash icons with cancel actions and hid deletes during active recording.
- Added styling for cancel controls and starting flash overlays.
- Ran npm install + npm run build (updated docs build artifacts).

### 🚧 In progress / placeholders
- None.

### ⏭️ Next actions / dependencies
- None.

## Summary of edits (what/where/why)
- `src/App.tsx`: add starting timers/cues, cancel handling, and start-state UI affordances.
- `src/App.tsx`: swap list/detail delete buttons to cancel actions for starting sessions and hide deletes while recording.
- `src/App.css`: style cancel hints/icons and add starting flash overlay keyframes.

## Self-evaluation
- Acceptance criteria met for early cancel, progressive cues, and icon wiring; changes committed and pushed.
