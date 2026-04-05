# Flows/parts + AI-human visibility documentation pass

- **Branch:** `cursor/-bc-98e9e1eb-06de-4625-a9bc-bbb30ee09882-df78`
- **Started (UTC):** 2026-04-05 05:20:41
- **Scope:** Documentation-only pass (no runtime code changes).

## Prompt summary

Create three repository-specific documentation artifacts:
1. A **flows-and-parts** document with critical/secondary flows and module definitions.
2. An **AI-to-human visibility** document describing instrumentation, object visibility, and log review strategy.
3. A **recommended refactors** document describing how to evolve the app toward the two documents above.

Also enforce collaboration discipline by appending the full raw user prompt to the active prompt log before any edits.

## Planning notes

- The app is a React PWA with a single large UI shell (`src/App.tsx`) and modular services in `src/modules/*`.
- Existing docs already describe architecture and modules, but not in the explicit "critical path + parts + visibility-tour" framing requested.
- The new documents should:
  - Use ubiquitous language for user-facing flows and system parts.
  - Clearly separate front-end components, domain back-end modules, and environmental harnesses.
  - Translate current logging/developer capabilities into an explicit AI-human observability model.
- No code behavior should change in this iteration.

## Acceptance criteria

- [x] Full raw user prompt appended verbatim to a branch-specific `*-PROMPT.txt`.
- [x] New branch-specific spec markdown file created with planning notes, todos, acceptance criteria, edit summary, and self-evaluation.
- [x] `documentation/flows-and-parts.md` created with:
  - [x] Critical path
  - [x] Secondary path
  - [x] Tertiary path
  - [x] Catalog of main front-end parts and back-end modules
- [x] `documentation/ai-to-human-visibility.md` created with:
  - [x] Visibility principles
  - [x] Module-level telemetry guidance
  - [x] Persisted-object visibility strategy
  - [x] Log review/copy strategy and filtering model
- [x] `documentation/recommended-refactors.md` created with prioritized refactor recommendations tied to the first two docs.
- [x] No application source code modified.

## Todo checklist

- [x] Locate active documentation conventions and branch-aware spec requirements.
- [x] Create new branch-specific spec/prompt pair.
- [x] Append user prompt to prompt log before documentation edits.
- [x] Inspect architecture and code modules for accurate naming/contracts.
- [x] Author three documentation files in `documentation/`.
- [x] Verify changed files are documentation-only.

## ✅ Done

- Created prompt transcript file:
  - `documentation/spec/20260405-052041_flows-parts-visibility-PROMPT.txt`
- Added this spec file:
  - `documentation/spec/20260405-052041_flows-parts-visibility.md`
- Added three requested docs:
  - `documentation/flows-and-parts.md`
  - `documentation/ai-to-human-visibility.md`
  - `documentation/recommended-refactors.md`

## 🚧 In progress / placeholders

- None in this documentation pass.

## ⏭️ Next actions / dependencies

- Review wording and terminology with the project owner, then standardize this document structure across other repositories.
- If approved, follow up with implementation work for:
  - Per-module visibility toggles and instrumentation registry.
  - UI decomposition of `App.tsx`.
  - End-to-end critical-path integration tests.

## Summary of edits (what / where / why)

- **What:** Added three new architecture-and-observability planning documents and a new spec/prompt pair.
- **Where:** `documentation/` and `documentation/spec/`.
- **Why:** To encode critical user-value paths, module contracts, and AI-human debugging/visibility strategy in a reusable, explicit format.

## Self-evaluation against acceptance criteria

| Criterion | Result | Notes |
| --- | --- | --- |
| Prompt appended before edits | Pass | Prompt file created first, then docs authored. |
| Critical/secondary/tertiary flows documented | Pass | Included with front-end + back-end touchpoints per step. |
| Parts catalog included | Pass | Front-end parts, domain modules, and environmental harnesses listed separately. |
| Visibility strategy documented | Pass | Includes telemetry events, object browsing, log sessions, filters, and export flow. |
| Refactor recommendations documented | Pass | Prioritized roadmap tied directly to the two new docs. |
| Runtime code unchanged | Pass | Documentation-only file additions. |
