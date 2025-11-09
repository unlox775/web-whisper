## Overview
- Goal: formalize session-level chunk timing management with a verification pass that recalculates deterministic start/end timestamps from verified audio durations, eliminating drift and misalignment in historical recordings.
- Scope: introduce a chunk session provider/model, add explicit timing status flags for chunks and sessions, trigger recomputation once volume profiles complete, and provide extensive inline documentation.

## ✅ Done
- Logged the initiating prompt for timing-verification overhaul.
- Audited manifest/session plumbing to pinpoint where deterministic timing should attach.
- Added explicit timing status fields for sessions/chunks with backwards-compatible defaults.
- Introduced `SessionChunkProvider` orchestration (volume hydration + verification + caching) with extensive inline commentary.
- Implemented manifest-level timing verification pass that rewrites start/end timestamps from verified durations.
- Updated `App` flow to automatically verify sessions on load and consume provider-generated analyses.
- Captured focused unit coverage for the sequential timing calculator.
- Sanitised chunk volume start/end offsets via `SessionChunkProvider` so histogram paths remain monotonic.
- Refined session detail header to show verified capture spans instead of stale `updatedAt` clocks.
- Expanded inline documentation across provider/utilities to meet the requested density guidelines.
- Adjusted histogram viewport to default to a 75 s window (≈2.5× zoom-out) for quicker whole-session scans.

## 🚧 In Progress
- Assess downstream visualizations for potential timing-status affordances.
- Documentation refresh (spec narrative, developer README) and CI/build validation.

## ⏭️ Next Actions
- Polish written docs/comments where additional clarity is useful.
- Run full build/test pipeline and surface results.
- Update status dashboards to reflect verified timing support.
- Evaluate whether UI should surface timing verification status directly to operators.
