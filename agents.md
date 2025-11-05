# Collaboration Playbook

This file documents how we keep human + agent collaboration transparent and auditable.

## Spec & Prompt Logging

- Every material update must add a pair of files under `docs/spec/`:
  - `YYYYMMDD-HHMMSS_slug.md` — Markdown changelog describing what changed, what remains undone, and any follow-up actions.
  - `YYYYMMDD-HHMMSS_slug-PROMPT.txt` — Plaintext transcript of the user prompt(s) that triggered the work, including subsequent clarifications in the same session.
- Use 24-hour UTC timestamps (retrieved via `date -u +%Y%m%d-%H%M%S`) to keep ordering unambiguous.
- Slugs should be short and hyphenated (e.g., `mvp-foundation`, `capture-loop`).
- If work spans multiple prompts, append each new prompt to the existing `*-PROMPT.txt` file with ISO-like separators.
- Spec files should clearly list:
  - ✅ Done (call out tangible code or configuration changes)
  - 🚧 In progress / placeholders
  - ⏭️ Next actions or dependencies

## Status Reporting

- `docs/README.md` holds the live traffic-light view of feature readiness. Update it whenever a status meaningfully changes.
- Architecture and deeper design notes live under `docs/` (e.g., `docs/architecture.md`).

## Source Layout Conventions

- Build artifacts intended for GitHub Pages live in `pwa-public/`.
- Runtime source follows `src/modules/<domain>/` for core services (capture, analysis, manifest, upload, transcription, settings).
- Unit and integration tests live under `test/`, with audio fixtures under `test/fixtures/audio/`.

Stick to this pattern so anyone can audit progress and understand outstanding work at a glance.
