# Transcription onboarding and mode handling

- Branch: cursor/transcription-onboarding-mode-handling-d6d2
- Date started: 2026-01-28

## Planning notes
- Review current onboarding UX and transcription mode behavior.
- Identify first-run touchpoints (settings, capture flow, prompts).
- Ensure mode handling is clear, safe, and recoverable.

## Todos
- [x] Inspect current onboarding and mode handling flows.
- [x] Design improved first-time onboarding messaging.
- [x] Implement onboarding + mode handling changes.
- [x] Update tests and documentation as needed.
- [ ] Run build, commit build artifacts, and push.

## Acceptance criteria
- First-time users see clear, friendly onboarding guidance.
- Mode handling is explicit, consistent, and safe.
- UI copy is concise and helpful without being noisy.
- Tests/validation updated for new behavior where applicable.

## Changes
### ✅ Done
- Added transcription mode + onboarding fields to settings storage.
- Added Groq API key validation helper and UI status display.
- Gated transcription flows when disabled/invalid to avoid false failures.
- Added onboarding callout and settings guidance for first-time users, plus a short setup cheat sheet.
- Clarified that Groq is a separate service in onboarding and settings copy.
- Added Groq setup popup with quick steps and direct link.
- Removed manual mode toggle; enabling now happens automatically on key paste and validation.
- Updated documentation status and roadmap references.

### 🚧 In progress / placeholders
- Run build, capture artifacts, and push commits.

### ⏭️ Next actions / dependencies
- Run npm install + npm run build, commit build output, and push.
- Re-check lint diagnostics for edited files.

## Summary of edits (what/where/why)
- `src/modules/settings/store.ts`: persist transcription mode/onboarding flags and migrate legacy settings.
- `src/modules/transcription/service.ts`: add Groq API key validation helper.
- `src/App.tsx`: add onboarding card, setup cheat sheet, mode-aware gating, and validation UI.
- `src/App.css`: style onboarding, settings sections, and paused/blocked states.
- `README.md`, `documentation/README.md`, `documentation/roadmap.md`: refresh onboarding guidance and status.
- `README.md`, `src/App.tsx`: clarify Groq is a separate service.
- `src/App.tsx`, `src/App.css`: add Groq setup popup with Go to Groq/OK actions.
- `src/App.tsx`, `src/modules/settings/store.ts`: remove manual mode toggle and auto-validate Groq key on paste.

## Self-evaluation
- The onboarding guidance is clearer and transcription respects explicit enabled/disabled modes.
- Key validation is visible with retry support; disabled mode avoids transcription failure states.
- Build/test steps still required before final submission.
