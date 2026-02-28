# Apple App Store preparation (living spec)

- Branch: `cursor/apple-app-store-preparation-36f8`
- Started (UTC): 2026-02-27
- Owner intent: Ship as a real Apple App Store application (TestFlight → App Store), with a realistic roadmap, edge-case coverage, and automated build/test checks.

## Scope

This spec covers:
- Upgrading the existing roadmap into an App Store–grade plan (Apple ecosystem concerns, compliance, metadata, localization, backup/iCloud expectations, notifications, background audio).
- Bringing the repo to a “builds cleanly” baseline and adding automation so every change runs reasonable tests and a build.
- Light product/UI copy updates to mention “native iOS app in progress” in a tucked-away area (not homepage/settings-first).

Out of scope (for now):
- Actually enrolling in Apple Developer Program / App Store Connect configuration (requires human account access).
- Implementing a full iOS native app unless the repo already contains an iOS wrapper scaffold; this spec will prepare the ground and document the remaining steps clearly.

## Acceptance criteria

- Roadmap is updated to include a realistic App Store submission track with edge cases and Apple ecosystem integration decisions (iCloud/backup, notifications, localization, privacy).
- Repo has automated checks (CI) that run on PRs/pushes: install, unit tests, and build.
- `npm install` + `npm run build` succeed in CI and locally in the agent environment.
- Build artifacts are handled intentionally (committed only where desired; otherwise ignored), and the policy is documented.
- Documentation status (`documentation/README.md`) reflects current readiness and the new App Store track.

## Plan / todos

### Roadmap & docs
- [ ] Upgrade `documentation/roadmap.md` with an App Store “track” (App Store Connect, signing, entitlements, privacy, localization, TestFlight, review edge cases).
- [ ] Cross-link/update `documentation/README.md` status to reflect iOS native app workstream and CI automation.
- [ ] Ensure contributor notes include Android wrapper and localization (already present) and add “where to find it” guidance.

### Build & automation
- [ ] Identify the project’s build/test commands (package scripts) and make sure they pass.
- [ ] Add GitHub Actions workflow to run `npm ci` (or `npm install` if required), `npm test`, and `npm run build`.
- [ ] Add/extend unit tests in `test/` for the most critical logic that is stable and meaningful.

### App Store readiness (prep only)
- [ ] Confirm/define decisions around iCloud backup vs local-only, notifications (if any), background audio recording requirement, and settings integration expectations.
- [ ] Document what “native wrapper” needs: audio session category, background modes, microphone permission strings, file storage strategy, and export/share.

## Edits log (append as work progresses)

- 2026-02-27: Created this spec and prompt log for the branch.
- 2026-02-27: Appended follow-up prompt about visible progress; continuing with roadmap/CI/build work next.
- 2026-02-27: Updated scope: deliver an installable iOS app project (TestFlight-ready) in-repo, with signing/build docs and CI for web.

## Self-evaluation (fill in at end)

- Roadmap realism and completeness: ⬜
- CI automation (tests + build): ⬜
- Build success in clean env: ⬜
- App Store prep documentation quality: ⬜

