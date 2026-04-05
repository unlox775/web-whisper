# Recommended Refactors

This document proposes implementation refactors to make the architecture and observability targets in:

- `documentation/flows-and-parts.md`
- `documentation/ai-to-human-visibility.md`

real and maintainable in code.

---

## 1) Refactor goals

1. Make core user-value flows explicit and testable end-to-end.
2. Strengthen separation between front-end orchestration and domain modules.
3. Add a disciplined, low-noise visibility layer that supports both human debugging and AI-assisted support.
4. Keep performance stable while improving diagnostics.

---

## 2) Priority roadmap

## P0 - Foundation (highest leverage, lowest product risk)

### R1. Create a centralized visibility registry
- **Problem:** Visibility behavior is currently scattered across startup milestones, ad-hoc logs, and UI handlers.
- **Refactor:** Add a single `visibilityRegistry` module that defines:
  - module keys (front-end + domain modules)
  - default enabled/disabled states
  - level presets (`minimal`, `critical-path`, `verbose`)
  - helper methods: `isEnabled(moduleKey)`, `emit(event)`
- **Suggested location:** `src/modules/logging/visibility-registry.ts`
- **Outcome:** One contract for instrumentation toggles and consistent behavior.

### R2. Standardize telemetry event envelopes
- **Problem:** Event payload shapes vary by emitter, making filtering and AI analysis inconsistent.
- **Refactor:** Introduce a typed event envelope and mapper:
  - `eventId`, `module`, `phase`, `severity`, `atMs`, `atIso`, `sessionId?`, `details`
- **Suggested location:** `src/modules/logging/visibility-events.ts`
- **Outcome:** Stable, machine-readable logs and easier export filtering.

### R3. Add module/event filtering in Developer Console logs tab
- **Problem:** Log review is chronological only; no quick hide/show by module or event family.
- **Refactor:** Extend logs UI with filters:
  - module
  - severity
  - event family (`ui`, `capture`, `storage`, `analysis`, `playback`, `transcription`)
  - phase (`start`, `success`, `error`)
- **Outcome:** Faster isolation of noisy modules and tighter "factory tour" debugging.

### R4. Extract startup orchestration from `App.tsx`
- **Problem:** Startup logic and milestone orchestration are embedded in a very large component.
- **Refactor:** Create `useAppBootstrap` hook returning:
  - hydrated settings
  - recordings + preview hydration state
  - main sync banner state
  - bootstrap errors
- **Outcome:** Cleaner critical-flow readability and easier critical-path integration tests.

---

## P1 - Critical-flow resilience and maintainability

### R5. Introduce explicit flow orchestrators
- **Problem:** Critical, secondary, and tertiary flows are implicit across many callbacks.
- **Refactor:** Add orchestration hooks/services:
  - `useCaptureFlow`
  - `useTranscriptionFlow`
  - `useDebugFlow`
- **Outcome:** Each flow gets explicit lifecycle states and instrumentation boundaries.

### R6. Split `App.tsx` into major UI parts
- **Problem:** One large file couples list/detail/settings/dev tools and increases regression risk.
- **Refactor:** Extract components:
  - `CapturePanel`
  - `SessionList`
  - `SessionDetailPanel`
  - `SettingsDialog`
  - `DeveloperOverlay`
  - `DoctorPanel` (subcomponent of detail)
- **Outcome:** Easier ownership boundaries and per-component visibility toggles.

### R7. Add integration tests for the primary critical path
- **Problem:** No single automated test proves "record -> persist -> open -> play -> transcribe" still works.
- **Refactor:** Add integration suite with mocked media + transcription:
  - start recording
  - generate chunk persistence
  - stop + session ready
  - open detail + playback source preparation
  - snip transcription result persisted
- **Suggested location:** `test/integration/critical-flow.test.ts`
- **Outcome:** Guardrail against regressions during refactors.

### R8. Add integration tests for secondary and tertiary flows
- **Secondary test:** retry failed transcription for existing session.
- **Tertiary test:** open dev overlay, inspect logs/tables, produce compact report.
- **Outcome:** Coverage for maintenance and observability workflows, not just happy-path capture.

---

## P2 - Observability depth and AI-support readiness

### R9. Introduce flow-aware log presets ("factory tours")
- **Problem:** Users and AI still must manually infer which events matter for each flow.
- **Refactor:** Add saved filter presets:
  - `Critical Capture Tour`
  - `Transcription Recovery Tour`
  - `Developer Diagnostics Tour`
- **Outcome:** One-click guided traces aligned to documented flows.

### R10. Add structured export profiles
- **Problem:** Copy export is useful but not configurable enough for different debugging scopes.
- **Refactor:** Add export modes:
  - `Compact` (AI chat)
  - `Detailed` (engineering deep dive)
  - `Critical Path Only`
- **Outcome:** Better signal-to-noise in shared logs.

### R11. Add optional persisted-object "inspect card" schema
- **Problem:** Raw JSON is accurate but cognitively heavy on mobile.
- **Refactor:** For sessions/chunks/snips, provide:
  - concise summary card
  - expand-to-raw JSON
- **Outcome:** Faster human inspection without losing full object transparency.

---

## 3) Domain module boundary refinements

### M1. Separate "domain storage APIs" from "developer inspection APIs"
- **Current issue:** `manifestService` owns both core runtime behavior and dev-table inspection methods.
- **Refactor:** Keep core methods in manifest service; move dev inspection methods into a dedicated `debugStorageInspector`.
- **Benefit:** Cleaner production contract and reduced accidental coupling.

### M2. Add explicit `TranscriptionQueue` implementation or remove queue placeholders
- **Current issue:** `enqueue/cancel` are stubs while direct `transcribeAudio` is used.
- **Refactor options:**
  - implement queue semantics with persisted jobs; or
  - simplify interface to only supported methods for now.
- **Benefit:** Contract clarity and fewer misleading code paths.

### M3. Decide lifecycle for `upload` and `telemetry` stubs
- **Current issue:** Modules exist but are effectively placeholders.
- **Refactor options:**
  - mark as experimental in docs and isolate from main exports; or
  - implement minimal production path.
- **Benefit:** Cleaner parts map and less ambiguity about supported flows.

---

## 4) Performance-safe instrumentation practices

Use these constraints while implementing visibility features:

- Keep default instrumentation lightweight.
- Emit high-frequency events only in verbose or sampled mode.
- Do not serialize large arrays/blobs unless explicitly requested.
- Ensure logging failures do not block user operations.
- Prefer count/size/duration summaries over full payload dumps.

---

## 5) Proposed implementation sequence

1. R1 + R2 (registry + event envelope).
2. R3 (log filters in dev overlay).
3. R4 + R6 (bootstrap extraction + component split).
4. R7 + R8 (critical/secondary/tertiary integration tests).
5. R9 + R10 + R11 (tour presets + export profiles + inspect cards).
6. M1/M2/M3 as contract-hardening cleanup.

This sequence minimizes regression risk while delivering immediate debugging value early.
