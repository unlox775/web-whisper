# AI-to-Human Visibility Layer

This document is the index and operating contract for the AI-to-human visibility package. The actual deep module tours now live under `documentation/ai-human-visibility/` as required by the AI Modulization Standard.

If you are trying to understand how to debug the system as a human operator (or how an AI should reason about logs and persisted state), start at:

- `documentation/ai-human-visibility/README.md`

That README defines the shared visibility envelope, toggles model, interpretation rules, and expected usage workflow. It also links the full per-module tours.

## Purpose of this index

The prior version of this file mixed summary rules and module details in one place. The updated standard requires one deep tour file per module so each module can be documented with enough mechanism depth, runtime narrative, signal interpretation guidance, and failure cues.

This index exists so there is one stable entry point while the detailed tours stay modular and maintainable.

## Module tour map

### Front-end (UI) module tours

- `documentation/ai-human-visibility/ui-application-shell.md`
- `documentation/ai-human-visibility/ui-capture-experience.md`
- `documentation/ai-human-visibility/ui-session-list-experience.md`
- `documentation/ai-human-visibility/ui-session-detail-experience.md`
- `documentation/ai-human-visibility/ui-settings-and-mode-experience.md`
- `documentation/ai-human-visibility/ui-diagnostics-experience.md`

### Back-end module tours

- `documentation/ai-human-visibility/backend-capture-domain.md`
- `documentation/ai-human-visibility/backend-session-storage-domain.md`
- `documentation/ai-human-visibility/backend-analysis-domain.md`
- `documentation/ai-human-visibility/backend-playback-slicing-domain.md`
- `documentation/ai-human-visibility/backend-transcription-domain.md`
- `documentation/ai-human-visibility/backend-settings-domain.md`
- `documentation/ai-human-visibility/backend-logging-and-visibility-domain.md`

## Maintenance rule

When module behavior changes, update the corresponding module tour first, then update this index only if module boundaries or file names changed.
