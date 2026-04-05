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

## Prompt summary (iteration 2)

Add a reusable, project-agnostic **AI Modulization Standard** document that captures the detailed philosophy from the original long prompt and governs how the three evergreen docs are created and maintained.

Update the existing three docs so they align with that standard:
- Keep **flows-and-parts** ideal-state and ubiquitous-language focused (not tied to current file placement).
- Keep **AI-to-human visibility** explicit about developer-mode toggles, inspectability, event expectations, and low-overhead behavior when debug mode is off.
- Reframe **recommended refactors** around litmus tests and yes/no adherence scoring against the standard.

## Planning notes

- Existing docs and source mapping gave enough context for a first pass, but the second pass needs a stronger standards-first framing.
- The new standard must be generic and portable across repositories.
- The three evergreen docs should be produced *from* that standard and then iteratively updated as app purpose or debugging learnings evolve.
- Refactor tracking should reflect adherence to standards, not just an engineering wish list.
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
- [x] Second user prompt appended verbatim to the same active branch prompt log.
- [x] Generic standards doc added and aligned with existing documentation set.
- [x] Existing three docs updated to conform to the new standard requirements (file-agnostic flow/parts, visibility tenets, litmus-style refactor adherence).

## Todo checklist

- [x] Locate active documentation conventions and branch-aware spec requirements.
- [x] Create new branch-specific spec/prompt pair.
- [x] Append user prompt to prompt log before documentation edits.
- [x] Inspect architecture and code modules for accurate naming/contracts.
- [x] Author three documentation files in `documentation/`.
- [x] Verify changed files are documentation-only.
- [x] Append second user prompt to active prompt log before second edit pass.
- [x] Add `AI Modulization Standard` document.
- [x] Refactor the three docs to comply with that standard and remove file-location coupling from flows-and-parts.
- [x] Reframe refactor doc around standards litmus tests and yes/no adherence.

## ✅ Done

- Created prompt transcript file:
  - `documentation/spec/20260405-052041_flows-parts-visibility-PROMPT.txt`
- Added this spec file:
  - `documentation/spec/20260405-052041_flows-parts-visibility.md`
- Added three requested docs:
  - `documentation/flows-and-parts.md`
  - `documentation/ai-to-human-visibility.md`
  - `documentation/recommended-refactors.md`
- Appended second prompt for this follow-up standards pass:
  - `documentation/spec/20260405-052041_flows-parts-visibility-PROMPT.txt`
- Added reusable standards anchor doc:
  - `documentation/AI-Modulization-Standard.md`
- Refactored evergreen docs to standards-driven, implementation-agnostic format:
  - `documentation/flows-and-parts.md`
  - `documentation/ai-to-human-visibility.md`
  - `documentation/recommended-refactors.md`

## 🚧 In progress / placeholders

- None.

## ⏭️ Next actions / dependencies

- After owner approval, apply the same standards package in other repositories.
- Optionally add a lightweight checklist template file that can be copied into future repos alongside the standard.

## Summary of edits (what / where / why)

- **What (iteration 1):** Added three new architecture-and-observability planning documents and a new spec/prompt pair.
- **What (iteration 2):** Added a reusable AI modulization standard doc and refactored the three evergreen docs to align with it.
- **Where:** `documentation/` and `documentation/spec/`.
- **Why:** To encode both the *standard itself* and project-specific adherence artifacts in a stable, repeatable workflow.

## Self-evaluation against acceptance criteria

| Criterion | Result | Notes |
| --- | --- | --- |
| Prompt appended before edits | Pass | Prompt file created first, then docs authored. |
| Critical/secondary/tertiary flows documented | Pass | Included with front-end + back-end touchpoints per step. |
| Parts catalog included | Pass | Front-end parts, domain modules, and environmental harnesses listed separately. |
| Visibility strategy documented | Pass | Includes telemetry events, object browsing, log sessions, filters, and export flow. |
| Refactor recommendations documented | Pass | Prioritized roadmap tied directly to the two new docs. |
| Runtime code unchanged | Pass | Documentation-only file additions. |
| Follow-up prompt appended before second-pass edits | Pass | Prompt log was appended before standards refactor edits. |
| Standards doc + standards alignment pass | Pass | Added generic standard and aligned all three evergreen docs to it. |
