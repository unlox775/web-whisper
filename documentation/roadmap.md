# Roadmap — App Store–ready iOS app (2026-02)

This roadmap is biased toward shipping a real App Store application, not just a PWA.
It tries to call out Apple ecosystem edge cases and decisions you only discover late
in the process.

Related:
- Known issues: [knownissues.md](knownissues.md)
- Contributor roadmap (optional): [contributor-roadmap.md](contributor-roadmap.md)

## Guiding constraints (so we don’t paint ourselves into a corner)

- **Privacy-first**: minimize data collection, keep audio local by default, and avoid surprise cloud sync.
- **Open-source signing**: anyone should be able to fork, set their own Bundle ID, and sign/build.
- **Background recording is a hard requirement on iOS**: PWA background recording is not reliable.
- **Deterministic release process**: every change runs tests and builds in CI; releases are repeatable.

## 0) Define product + compliance decisions early (unblocks everything else)

Task: Decide the “App Store story” for data, privacy, and UX. These decisions affect
entitlements, review risk, and implementation.

Goals:
- Avoid iCloud surprise backups and “where did my audio go?” confusion.
- Make App Store review questions easy to answer consistently.

Acceptance criteria:
- A short written decision doc exists in this roadmap (below) covering: local storage, backup behavior, exports, third-party services, and notifications.
- The App Store Privacy “nutrition label” answers are known (even if implementation is still in progress).

Decisions to make (recommended defaults for this app):
- **iCloud / backup**: recordings are **local-only** by default; large audio files should be marked “do not back up” in the native app sandbox to avoid iCloud/iTunes backup bloat.
- **Cloud sync**: no iCloud Drive / CloudKit sync initially; add later only if it’s a first-class feature.
- **Notifications**: no push notifications; optionally add **local notifications** only if they solve a clear UX problem (e.g., “transcription finished” when you left the app).
- **Localization**: start with English UI; structure strings for localization early; localize App Store listing before launch if feasible.

## 1) Native iOS app (App Store) — background recording and “real app” behaviors

Task: Ship a minimal native iOS app that can record in the background and is ready for
TestFlight and App Store submission.

Goals:
- Record reliably while backgrounded / screen locked.
- Keep the iOS project minimal and forkable for open-source users.
- Preserve the existing web UI as much as possible (short-term), while allowing native capture.

Acceptance criteria:
- Recording continues when backgrounded and after the screen locks; playback is gap-free on-device.
- Microphone permission copy is correct and review-safe.
- A clean “build + sign + TestFlight upload” doc exists and has been followed successfully at least once.

Key sub-tasks (with common edge cases):
- **Architecture choice**:
  - Option A: native recorder + native UI (most reliable, most work).
  - Option B (recommended first): native shell (Swift) + embedded web UI (`WKWebView`) + **native background audio capture** exposed to JS via a small bridge.
  - Define what stays web (session list, transcription UI) vs what becomes native (audio capture pipeline).
- **Background audio session**:
  - Use `AVAudioSession` category that supports background recording (`playAndRecord`) and enable background mode “Audio”.
  - Handle route changes (Bluetooth, wired headset), interruptions (calls/Siri), and reactivation.
- **File storage + retention**:
  - Store audio under `Application Support` (or `Documents` only if you want it visible in Files).
  - Explicitly set “do not back up” attribute for large audio blobs (default for App Store sanity).
  - Mirror existing retention policy so storage doesn’t grow forever.
- **Export/share**:
  - Provide a “Share” action (AirDrop, Files, etc.) for full-session audio; this reduces support burden.
- **Permissions & required Info.plist strings**:
  - `NSMicrophoneUsageDescription` is mandatory.
  - If adding notifications: `NSUserNotificationUsageDescription` (and only request when needed).
- **Networking**:
  - If using Groq from the device, ensure ATS (App Transport Security) is satisfied (HTTPS only).
  - Document what data is sent to Groq (audio snips only, not full sessions, etc.).

## 2) App Store Connect track (metadata, review, compliance)

Task: Prepare everything that blocks submission even if the app “works”.

Goals:
- Avoid last-minute rejections due to missing policies, unclear permissions, or metadata gaps.

Acceptance criteria:
- App Store Connect app record is created and consistent with the app’s behavior.
- Required metadata is drafted and stored in-repo (so it’s versioned): description, keywords, support URL, privacy policy URL, screenshots plan.

Checklist (what usually surprises people):
- **Bundle ID + provisioning**: explicit Bundle ID, capabilities, and signing docs for other contributors.
- **App Privacy (nutrition label)**:
  - Confirm: no tracking, no advertising ID, no analytics unless you add it.
  - Declare that audio is user-generated content and may be processed by a third party (Groq) if transcription is enabled.
- **Privacy policy**:
  - Even if you collect nothing, you still need a policy describing local storage + optional transcription behavior.
- **Export compliance**:
  - Most apps still answer export questions (even if only using standard TLS); document expected answers.
- **Age rating / content**:
  - Decide how to describe “user-generated audio content” in the rating questionnaire.
- **Review notes**:
  - Provide a short “How to test” for reviewers (microphone permission, how to start/stop, what transcription does).

## 3) iCloud / Apple ecosystem integration (optional, but decide explicitly)

Task: Make iCloud behavior intentional (either clearly “no sync” or a designed sync feature).

Goals:
- Avoid unexpected iCloud backup size issues.
- Avoid user confusion about where recordings live.

Acceptance criteria:
- The app communicates clearly: local-only vs sync, and how to export/backup.
- If sync is added: the chosen mechanism is implemented end-to-end (CloudKit vs iCloud Drive) with conflict handling.

## 4) Notifications (optional)

Task: Decide whether any notifications improve the product.

Good fits:
- Local notification when a transcription finishes (only if the user left the app).
- Local notification if a recording is stopped due to interruption and needs attention.

Acceptance criteria (if implemented):
- Notifications are **local-only**, opt-in, and can be disabled.
- Notification permission is requested only when the feature is enabled.

## 5) Localization and translations (UI + App Store listing)

Task: Structure UI strings for localization and plan translations.

Goals:
- Don’t block launch on perfect translations, but don’t hardcode strings everywhere either.

Acceptance criteria:
- UI strings are centralized (so adding locales later is realistic).
- App Store listing supports at least English; additional locales are tracked as follow-ups.

## 6) Quality gates (automation, tests, “builds cleanly”)

Task: Make every change run reasonable tests and a build automatically.

Acceptance criteria:
- CI runs on every push/PR: install, unit tests, and production build.
- The repo builds cleanly in a fresh environment.

## 7) Remaining web-app polish (still valuable even with iOS native work)

These are still worth doing because the iOS app will likely reuse the web UI initially.

### 7.1) Full-session audio download
Task: Add a download/export action for the complete session audio.
Acceptance criteria:
- A visible export/download action exists on the session detail view.
- The exported file plays end-to-end.

### 7.2) Cross-browser compatibility pass
Task: Run a structured compatibility sweep across iOS Safari, iOS Chrome, Android Chrome, macOS Safari, Windows Chrome/Edge.
Acceptance criteria:
- A matrix documents tested versions with pass/fail notes and known issues.
- Top blockers are fixed or documented with reproducible steps/workarounds.

### 7.3) Clipboard-first transcription UX
Task: Make copying finished transcriptions fast (especially on iOS).
Acceptance criteria:
- One-tap copy for completed transcriptions (tile-level or detail view).
- Clear UI feedback when copied.

## Completed (historical)

- Storage retention and automatic deletion (spec: [20260125-071411_storage-retention-policy-de1c.md](spec/20260125-071411_storage-retention-policy-de1c.md))
- Transcription onboarding and mode handling (spec: [20260128-192159_transcription-onboarding-mode-handling.md](spec/20260128-192159_transcription-onboarding-mode-handling.md))
