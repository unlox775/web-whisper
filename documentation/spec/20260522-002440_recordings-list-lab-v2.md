# Recordings List Lab V2

- **Branch:** `main`
- **Started (UTC):** 2026-05-22
- **Prompt log:** `documentation/spec/20260522-002440_recordings-list-lab-v2-PROMPT.txt`
- **Related prior note:** `documentation/spec/20260324-175736_indexeddb-main-ui-performance.md`
- **Reference pattern:** `/Users/dave/keepers/mirrors/dave/scriptures-sticky-scroll-pwa/documentation/spec/20260519-185616_infinite-scroller-v3.md`

## Owner Intent

Change the build methodology from "one large app with many hidden moving parts" to small, visual, reusable labs. Each lab should isolate one important subsystem, make its runtime behavior visible, and allow iteration on a versioned replacement before swapping it into the production app.

This is not the old debug-layer approach. The desired pattern is a focused one-page lab: the working component on the left, live telemetry and event ticker on the right, and enough instrumentation to see what database calls, data volume, render work, and offscreen behavior are happening.

## Lab Methodology

- Build subsystem versions independently (`V2`, then later `V3`, etc.) without replacing the production app until the lab version is good.
- Keep the lab component reusable enough that production can later import the same code instead of reimplementing it.
- Keep each lab one page for now: preview on the left, variable telemetry on the right.
- Make invisible work visible: IndexedDB calls, durations, rows loaded, estimated bytes, scroll windows, render windows, and click/navigation events.
- Prefer clean, simple subsystem APIs over coupling labs to the full `App.tsx` state machine.

## Candidate Labs

- **Recordings list / home screen loading:** paged loading, virtualized rendering, previews, database call telemetry, click event surface.
- **Recording capture chunks:** MediaRecorder/session creation, chunk append cadence, byte growth, wake lock behavior, chunk timeline.
- **Snip detection:** volume windows, pause detection, snip boundaries, transcription queue inputs.
- **Recording detail playback:** chunk metadata loading, blob assembly, playback source preparation, doctor timeline.
- **Developer console / IndexedDB browser:** table counts, page reads, row serialization cost, log export path.
- **Settings / onboarding:** Groq key validation, model settings, retention limits, local persistence.

## V2 Scope

Build the first lab for only the main recordings list. Do not include the capture box, header, settings, detail modal, transcription retry actions, delete behavior, or production navigation. Card clicks should emit a lab event rather than opening detail.

The V2 list should:

- Look and feel close to the current production recording cards.
- Load recording rows in pages instead of forcing the whole list path into the UI at once.
- Render only the visible list window with spacer rows so a large database can be explored.
- Show telemetry for the exact database calls, durations, rows, estimated bytes, loaded range, render range, and user interactions.
- Use a component that can later be imported by production.

## Done

- Created this spec/prompt pair for the lab methodology and V2 recordings-list effort.
- Added `manifestService.listSessionsPage()` so the lab can read session rows by page using the `by-updated` index instead of the current full `listSessions()` path.
- Added reusable `RecordingsListV2` React component with fixed-height virtual rendering, paged loading, database-call telemetry, loaded-range stats, and an event ticker.
- Added `recordings-list-v2-lab.html` and `src/recordings-list-v2-lab.tsx` as a standalone one-page lab.
- Added Vite multi-page build input so the lab can be emitted into `docs/` alongside the main app.
- Ran `npm install` and `npm run build`; TypeScript and Vite build pass, and `docs/recordings-list-v2-lab.html` is emitted.
- Updated `Makefile` to match the scripture lab workflow more closely: `make build`, `make run-local`, `make run-recordings-list-lab`, `make bounce`, and `make bounce-lab`.
- Restyled the lab telemetry side as a white, separate lab console so it is visually distinct from the app-themed recordings widget.
- Added a developer-mode-only Labs row in Settings below the storage cap with a link to `recordings-list-v2-lab.html`.
- Added a Back to home link in the lab header for returning to the production app page.
- Adjusted the lab desktop layout to a 50/50 split so the telemetry panel takes half the window.

## Run Workflow

- Main app: `make run-local` or `make bounce`.
- Recordings list V2 lab: `make run-recordings-list-lab` or `make bounce-lab`.
- Both run paths kill any existing server on `PORT` (default `5173`), build to `docs/`, start Vite, and open the browser to the target page.
- To use another port: `make bounce-lab PORT=5174`.

## In Progress / Placeholders

- Production app swap-in is intentionally not started.
- Transcription preview optimization is intentionally not included in V2; the list currently labels previews as not loaded.

## Next Actions

- Try the lab against a large real database and tune `pageSize`, row height, and overscan.
- Decide whether V2 should add paged transcription-preview reads or leave previews as a separate lab/version.
- After V2 proves the list loading model, plan a production swap-in that removes the current home-list coupling from `App.tsx`.
- On deployed GitHub Pages, enable developer mode, open Settings, and use Labs → Recordings list V2 to test against the existing production IndexedDB dataset.

## Self-Evaluation

Pass for first lab cut. The implementation keeps production behavior untouched while creating the first visual lab surface for home-list loading, database-call telemetry, paged loading, and virtual rendering. Remaining risk is browser/runtime QA against a large real IndexedDB dataset.
