# Recommended Refactors

This document is a living adherence report against:

- `documentation/AI-Modulization-Standard.md`
- `documentation/flows-and-parts.md`
- `documentation/ai-to-human-visibility.md`

It tracks whether the implementation follows the standard, what value each gap affects, and what refactors are required to converge.

---

## 1) How to use this document

This document should be updated in each iteration loop:

1. Re-check standards and litmus tests.
2. Mark each criterion `Yes`, `Partial`, or `No`.
3. Record evidence and user impact.
4. Update or close corresponding refactor actions.

When all important criteria are `Yes`, this document should explicitly state that the system is near ideal and mostly in maintenance mode.

---

## 2) Adherence scoreboard (litmus-driven)

Status key:

- **Yes**: Standard is met with stable evidence.
- **Partial**: Some structure exists but misses required guarantees.
- **No**: Standard not implemented or not operationally usable.

| Litmus criterion | Status | Why it matters | Current evidence | Gap summary |
| --- | --- | --- | --- | --- |
| Flow document is implementation-agnostic | **Partial** | Keeps architecture docs stable across refactors | Flows doc now rewritten toward ideal-state language | Needs sustained discipline in future edits |
| Critical/secondary/tertiary flows are explicit | **Yes** | Protects primary and secondary user value | Flows are explicitly defined as user stories | Need automated verification coverage expansion |
| Front-end parts and back-end modules clearly separated | **Partial** | Prevents architecture sprawl and hidden coupling | Domains are named and separated in docs | Runtime architecture still has concentrated orchestration |
| Major modules have explicit contracts | **Partial** | Enables safe refactoring and AI maintainability | Contracts exist in many services | Contract clarity inconsistent across all modules |
| Debug mode and visibility layer are explicit | **Partial** | Enables repeatable diagnostics | Developer mode + logs + table views exist | Per-module toggle model not fully implemented |
| Module-level visibility toggles available | **No** | Core requirement of standard observability | No universal toggle registry for all parts/modules | Needs centralized visibility registry and UI |
| Per-module narrative factory tours exist | **Yes** | Makes visibility operational, not just index-level | `documentation/ai-human-visibility/` now contains module-level deep tours + index | Keep tours synchronized with behavior changes |
| Persisted object browsing (summary + raw) | **Partial** | Reduces debugging time and ambiguity | Object/table browsing exists | Summary-vs-raw UX consistency needs improvement |
| Log sessions persist and are reviewable | **Yes** | Supports post-run diagnostics | Session-scoped logs are persisted and navigable | Add stronger filtering and export controls |
| Log filtering by module/event family/severity | **Partial** | Allows isolation of noisy components | Basic log browsing exists | Missing robust multi-dimension filters |
| Copy/export diagnostics for AI | **Yes** | Enables AI-assisted debugging loops | Compact report export exists | Add profile-based export modes |
| Off-mode observability has minimal cost | **Partial** | Prevents debug harness from harming UX | Existing logging is mostly bounded | Need formal benchmark and stricter gating for all modules |
| Debug toggles do not alter normal UX behavior | **Partial** | Prevents user-facing regressions | Current dev mode mostly isolated | Need policy-level enforcement + tests |
| Critical flow verification | **Partial** | Prevents regressions in core value path | Manual confidence and scattered checks | Add a dedicated end-to-end critical flow suite |
| Secondary flow verification | **Partial** | Protects high-value recovery workflows | Some behavior tested indirectly | Add explicit retry/recovery integration tests |
| Tertiary (debug) flow verification | **No** | Ensures diagnostics tooling itself is reliable | No complete debug-flow test protocol yet | Add automated/manual protocol and acceptance criteria |

---

## 3) Priority refactor actions

## P0 - Standards compliance foundation

### RF-01: Build centralized visibility registry and toggle model
- **Addresses:** module-level toggles, debug control consistency, off-mode gating.
- **Deliverables:**
  - canonical list of instrumentable front-end parts and back-end modules
  - toggle state model and defaults
  - helpers for guarded event emission
- **Success condition:** every major part/module has explicit on/off visibility control.

### RF-02: Standardize telemetry envelope across modules
- **Addresses:** inconsistent event shape and poor filtering.
- **Deliverables:**
  - typed event schema (module, eventId, phase, severity, timestamps, session context)
  - migration of key emitters to schema
- **Success condition:** logs are machine-filterable and comparable across modules.

### RF-03: Add robust log filtering controls in diagnostics UI
- **Addresses:** noisy timeline analysis and weak isolation.
- **Deliverables:**
  - filters for module, family, severity, phase
  - saved filter presets for common flow tours
- **Success condition:** users can isolate one flow/module without manual scanning.

### RF-03b: Keep module tour docs synchronized with implementation
- **Addresses:** drift between visibility stories and runtime behavior.
- **Deliverables:**
  - module-tour update trigger in documentation workflow
  - quick checklist per module tour (`mechanism`, `signals`, `healthy sequence`, `failure cues`)
- **Success condition:** module tours remain trusted operational guides, not stale prose.

---

## P1 - Flow reliability and module separation

### RF-04: Decompose orchestration into flow-centric boundaries
- **Addresses:** concentration of orchestration and hidden coupling.
- **Deliverables:**
  - explicit flow orchestration units for capture, transcription recovery, diagnostics
  - clear boundaries between UI composition and domain execution
- **Success condition:** flow logic is explicit, testable, and not monolithic.

### RF-05: Introduce critical-flow integration verification
- **Addresses:** regression risk in core user value path.
- **Deliverables:**
  - repeatable test path: start -> persist -> stop -> open -> playback -> transcript
  - deterministic pass/fail outcomes
- **Success condition:** critical flow is continuously verifiable.

### RF-06: Add secondary and tertiary flow verification protocols
- **Addresses:** weak assurance for recovery/debug experiences.
- **Deliverables:**
  - secondary flow test/protocol (retry and convergence)
  - tertiary flow test/protocol (diagnostics visibility and export path)
- **Success condition:** non-primary but high-value flows are reliably verifiable.

---

## P2 - Observability maturity and ergonomics

### RF-07: Add persisted-object inspector UX standards
- **Addresses:** raw JSON usability limitations.
- **Deliverables:**
  - consistent summary cards + expand-to-raw views for key objects
  - object-centric drill-down patterns
- **Success condition:** mobile-friendly, low-friction object inspection.

### RF-08: Add export profiles for AI collaboration
- **Addresses:** one-size export limitations.
- **Deliverables:**
  - compact / detailed / critical-flow-only export profiles
  - bounded payload strategies for large sessions
- **Success condition:** right-sized evidence sharing for different debugging contexts.

### RF-09: Add observability performance guardrails
- **Addresses:** uncertainty around instrumentation cost and behavior drift.
- **Deliverables:**
  - benchmark/checklist for debug-off overhead
  - tests for behavior invariance when toggles change
- **Success condition:** visibility layer remains safe by default.

---

## 4) Current grade and target

- **Current overall adherence grade:** **C (Partial)**
- **Target grade:** **A/B range** via RF-01 through RF-06 completion first, then RF-07 through RF-09.

The highest-value movement is to complete the P0 set first, then lock in flow verification in P1.

---

## 5) Notes for future updates

When this document is updated:

1. Keep scoring objective and evidence-based.
2. Prefer closing gaps that unlock multiple litmus criteria.
3. Remove completed actions from "active gaps" and record them in completion history.
4. If all critical criteria become `Yes`, state that adherence is near ideal and move to maintenance posture.
