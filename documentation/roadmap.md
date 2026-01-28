# Final polish roadmap (2026-01)

This is a terse list of final polish and platform tasks. Each item includes the task,
the goals, and acceptance criteria to confirm completion.

Related:
- Known issues: [knownissues.md](knownissues.md)
- Contributor roadmap: [contributor-roadmap.md](contributor-roadmap.md)

## 1) iOS native app and background recording
Task: Ship a minimal native iOS wrapper so recording continues while the app is in
the background (PWA background recording is not reliable on iOS).
Goals: Enable background recording, keep the build minimal, and make it easy for
others to sign with their own Apple credentials.
Acceptance criteria:
- Recording continues while the app is backgrounded or the screen is locked, and the
  session plays back without gaps.
- iOS background audio session is configured and validated on at least one device.
- Build instructions exist for local signing, TestFlight, and App Store submission,
  using a repo-local iOS folder.

## 2) Transcription onboarding and mode handling
Task: Define "transcription disabled" and "transcription enabled" modes, validate the
Groq API key, and document first-time setup and cost expectations with a disclaimer.
Goals: Reduce first-run confusion and make the no-key experience behave like a
functional audio recorder.
Acceptance criteria:
- Settings clearly show transcription enabled or disabled, and key validation toggles
  state with a retry path when invalid.
- When transcription is disabled, recordings show "recording complete" (not
  "transcription failed") and remain playable.
- Getting-started guidance explains how to obtain a Groq key and what to expect about
  costs, with a disclaimer.

## 3) Full-session audio download
Task: Add a download action for the complete session audio.
Goals: Allow users to export recordings without relying on snips or developer mode.
Acceptance criteria:
- A visible download button exists on the session detail view.
- The downloaded file contains the entire session audio and plays end to end.

## 4) Cross-browser compatibility pass
Task: Run a structured compatibility sweep across iOS Safari, iOS Chrome, Android
Chrome, macOS Safari, and Windows Chrome/Edge, then document and fix blockers.
Goals: Establish a known-good browser matrix and track regressions.
Acceptance criteria:
- A matrix documents tested versions with pass/fail notes and known issues.
- The top blockers are fixed or documented with reproducible steps and workarounds.

## 5) Usability feedback sessions
Task: Run small focus-group sessions and document usability pain points.
Goals: Capture real user feedback before deeper UI polish.
Acceptance criteria:
- Notes exist for at least three feedback sessions.
- The top five issues and next-step tasks are summarized.

## 6) Support and maintenance expectations
Task: Document the long-term support posture and community contribution expectations.
Goals: Set clear expectations and encourage community-driven fixes.
Acceptance criteria:
- README explains support expectations and how to report issues on GitHub.
- Contribution notes encourage AI-assisted fixes and clarify maintainer availability.

## 7) Clipboard-first transcription UX
Task: Make copying finished transcriptions fast, especially on iOS.
Goals: Remove the friction of selecting text and provide a single-tap copy path.
Acceptance criteria:
- When a transcription finishes, the app can auto-copy it and surface a brief
  confirmation (e.g., "Copied to clipboard").
- Session tiles expose a copy icon that copies completed transcripts without opening
  the detail view.
- Manual copy remains available for partial/failed transcripts with clear state.

## Deferred until after feedback
- Visual polish beyond necessary usability fixes.

## Completed
- Storage retention and automatic deletion (spec: [20260125-071411_storage-retention-policy-de1c.md](spec/20260125-071411_storage-retention-policy-de1c.md))
