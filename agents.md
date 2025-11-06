**ALWAYS PREPEND NEW USER PROMPTS TO THE ACTIVE PROMPT LOG BEFORE MAKING CHANGES.**

# Collaboration Playbook

This file documents how we keep human + agent collaboration transparent and auditable.

## Spec & Prompt Logging

- Maintain a single active spec/prompt pair for the current effort (presently `20251105-210414_mvp-foundation.*`).
- Every material update must append to that pair under `documentation/spec/`:
  - `YYYYMMDD-HHMMSS_slug.md` — living Markdown changelog describing what changed, what remains undone, and any follow-up actions.
  - `YYYYMMDD-HHMMSS_slug-PROMPT.txt` — plaintext transcript capturing **every** user prompt or follow-up, prepended newest-first.
- Use 24-hour UTC timestamps (retrieved via `date -u +%Y%m%d-%H%M%S`) to keep ordering unambiguous.
- Slugs should be short and hyphenated (e.g., `mvp-foundation`, `capture-loop`).
- For each new instruction, prepend a new section to the prompt log with timestamp + raw transcript before writing code.
- Spec files should clearly list:
  - ✅ Done (call out tangible code or configuration changes)
  - 🚧 In progress / placeholders
  - ⏭️ Next actions or dependencies

## Status Reporting

- `documentation/README.md` holds the live traffic-light view of feature readiness. Update it whenever a status meaningfully changes.
- Architecture and deeper design notes live under `documentation/` (e.g., `documentation/architecture.md`).

## Source Layout Conventions

- Build artifacts intended for GitHub Pages live in `docs/`.
- Runtime source follows `src/modules/<domain>/` for core services (capture, analysis, manifest, upload, transcription, settings).
- Unit and integration tests live under `test/`, with audio fixtures under `test/fixtures/audio/`.

Stick to this pattern so anyone can audit progress and understand outstanding work at a glance.
