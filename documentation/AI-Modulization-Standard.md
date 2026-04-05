# AI Modulization Standard

This document defines a reusable, project-agnostic standard for building and maintaining AI-assisted applications that remain understandable, modular, debuggable, and evolvable over time.

It is intentionally written so it can be copied into other repositories and used as a template. It should not depend on specific file names, frameworks, or current implementation locations.

---

## 1) Purpose

The purpose of this standard is to ensure that:

1. An application's main user value can be described as clear, testable flows.
2. Front-end parts and back-end modules are explicitly defined with stable contracts.
3. Humans can inspect and debug the running system using an intentional AI-to-human visibility layer.
4. Refactoring work is continuously measured against explicit standards, not gut feel.

This standard is not a one-time document. It is a repeatable operating model:

1. Read this standard.
2. Produce/update **Flows and Parts**.
3. Produce/update **AI-to-Human Visibility**.
4. Produce/update **Recommended Refactors** as an adherence report.
5. Implement code changes.
6. Re-evaluate adherence and iterate.

---

## 2) Cardinal tenets

These are the non-negotiable rules.

### Tenet A - Explicit module boundaries

Every major front-end part and back-end module must be clearly defined with:

- responsibility
- owned data/objects
- primary contract methods
- dependencies it is allowed to call

Back-end modules should represent meaningful business/use-case domains, not arbitrary technical fragments. Shared infrastructure (logging, persistence, transport) may exist as environmental harnesses but should not erase domain boundaries.

### Tenet B - Ubiquitous language over implementation details

Architecture documents must be written in domain language that explains user value and system behavior. They should remain valid even if file structure changes.

Good documents explain what a **Session**, **Order**, **Job**, **Report**, or **Snip** is in product terms, not where it currently lives in code.

### Tenet C - Flow-first architecture communication

Every application must identify:

- one **critical flow** (primary user value path)
- at least one **secondary flow**
- optional tertiary/quaternary flows as needed

Flows must be told as short, readable step sequences that include:

- major front-end part touched
- major back-end module touched (excluding generic plumbing unless required)
- why that step contributes to user value

### Tenet D - Built-in AI-to-human visibility

Every major front-end part and back-end module must support an instrumentation mode that can be turned on/off intentionally. Debugging must be designed as a first-class experience, not an afterthought.

Humans must be able to:

- inspect key persisted objects in simplified and raw views
- inspect flow events over time
- filter noisy modules in logs
- copy relevant diagnostics for AI analysis

### Tenet E - Performance-safe observability

Instrumentation must be implemented so that when debug mode is off, performance impact is zero or near-zero in normal usage.

Turning visibility on may add overhead, but must not:

- break functional behavior
- introduce hidden side effects
- force noisy visual changes in normal user views

### Tenet F - Continuous adherence via refactor scorecard

A living refactor document must track how closely the implementation adheres to this standard and the two derivative docs (Flows/Parts and Visibility).

The refactor document is not a generic backlog; it is an adherence and gap report.

---

## 3) Required documents and their roles

This standard requires three evergreen companion documents.

## 3.1 Flows and Parts (design intent and language)

**Role:** Describe what the application is trying to do in domain language.

Must include:

- critical flow
- secondary flow
- optional tertiary/quaternary flows
- major front-end parts
- major back-end modules
- environmental harnesses

Must avoid:

- binding architecture truth to current file layout
- overfocusing on temporary implementation shortcuts

Output quality check:

- A new engineer can understand user value and system shape without opening code.
- A future refactor can move files without invalidating this doc.

## 3.2 AI-to-Human Visibility (debugging intent)

**Role:** Define how a human and AI can inspect the system during real issues.

Must include:

- visibility principles and goals
- module-level telemetry/event guidance
- expected event frequencies/noise notes
- persisted-object viewing strategy
- log session and filtering model
- export/copy strategy for AI collaboration

Must answer:

- What do we turn on?
- What do we see?
- How noisy is it?
- How do we share it?

## 3.3 Recommended Refactors (adherence report)

**Role:** Track how far reality is from the target defined by the first two docs and this standard.

Must include:

- yes/no or scored litmus checks
- current adherence state
- concrete gap-removal tasks
- status progression over time

Should explicitly say when adherence is high and work is complete.

---

## 4) Litmus tests (run on any application)

Use these tests to grade whether a project follows the standard.

## 4.1 Document quality litmus tests

1. **Flow clarity test:** Can someone read the critical flow quickly and understand full user value?
2. **Ubiquitous language test:** Are terms product/domain-centric rather than file-centric?
3. **Boundary test:** Are front-end parts and back-end modules clearly separated?
4. **Stability test:** Would docs still make sense if implementation files were reorganized?

## 4.2 Visibility litmus tests

5. **Toggle test:** Can debug visibility be turned on/off intentionally?
6. **Coverage test:** Can all major parts/modules be individually instrumented?
7. **Object inspection test:** Can key persisted objects be browsed in summary + raw form?
8. **Session history test:** Are logs persisted per session/activation and reviewable later?
9. **Filter test:** Can noisy modules/events be hidden while reviewing logs?
10. **Export test:** Can a human copy diagnostics into AI chat without unbounded payloads?

## 4.3 Performance and safety litmus tests

11. **Off-mode cost test:** Is observability off-mode overhead effectively negligible?
12. **Behavior invariance test:** Does toggling debug mode avoid changing user-facing behavior by default?
13. **Failure isolation test:** Do logging/instrumentation failures avoid breaking core flows?

## 4.4 Flow reliability litmus tests

14. **Critical flow verification test:** Is there automated or repeatable validation of critical flow?
15. **Secondary flow verification test:** Is secondary value path verifiable?
16. **Tertiary flow verification test:** Is diagnostics/debug flow itself verifiable?
17. **Test realism test:** Where automation is difficult, is there a defined manual/browser test protocol?

---

## 5) Grading model

Use a simple adherence grade:

- **A (Excellent):** Standards fully implemented; refactor doc mostly closed.
- **B (Strong):** Core standards present; a small set of meaningful gaps remains.
- **C (Partial):** Major intent present but inconsistent implementation and missing controls.
- **D (Weak):** Documents exist but are mostly descriptive, not actionable or enforceable.
- **F (Absent):** No usable standards-driven architecture/debug discipline.

Recommended Refactors should map each litmus test to:

- status: `Yes` / `Partial` / `No`
- evidence
- value impact
- next action (if not Yes)

---

## 6) Debugging experience standard

Any app following this standard should provide a coherent debugging experience.

Minimum expectations:

1. A discoverable debug entry point (for authorized/dev users).
2. A module list showing instrumentable front-end parts and back-end modules.
3. Per-module toggle controls.
4. Persisted-object browsing views.
5. Session-based logs with filtering.
6. Copy/export path for AI collaboration.

Optional but recommended:

- flow presets ("critical flow tour", "transcription recovery tour", etc.)
- verbosity levels
- secure remote retrieval for AI tooling

---

## 7) Anti-patterns this standard prevents

1. **"Everything in one giant UI file" architecture drift**
2. **Unclear boundaries where modules call each other ad hoc**
3. **Docs tied to current code placement instead of domain truth**
4. **Ad-hoc logging that is too noisy or too sparse to debug**
5. **Debug mode that changes user UI behavior unpredictably**
6. **No objective way to tell whether refactors actually improved structure**

---

## 8) Operating rhythm

When starting significant work:

1. Re-read this standard.
2. Update Flows and Parts if product behavior changed.
3. Update AI-to-Human Visibility if debugging needs changed.
4. Update Recommended Refactors as a current adherence snapshot.
5. Implement code changes.
6. Re-score adherence.

When adherence reaches high confidence:

- Recommended Refactors should explicitly say that the system is near ideal and list only minor maintenance items.

---

## 9) Definition of success

This standard is successful when:

- humans can quickly understand the system in domain language
- modules are clearly separated and contract-driven
- critical flows are dependable and verifiable
- debugging is intentional, fast, and useful
- AI assistants can diagnose issues using structured, shareable evidence
- refactors are guided by measurable adherence, not guesswork

