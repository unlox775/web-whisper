# AI-to-Human Visibility Module Tours

This folder is the deep, per-module visibility layer required by the AI Modulization Standard. The top-level `documentation/ai-to-human-visibility.md` file explains shared principles, contracts, and operating rules. This folder explains the same system as guided tours, one module at a time, so a human can walk the factory floor without guessing.

The design intent here is deliberate: summary documents are useful for alignment, but debugging quality is won in module detail. Each module tour describes what the module is trying to do, why that work is tricky in runtime conditions, what evidence signals matter, what a healthy timeline looks like, and what failure patterns usually mean. The writing style is intentionally operational. It is meant to be readable under pressure when someone is diagnosing behavior, not just during calm architecture review.

All module files use the naming convention required by the standard:

- `ui.<module-name>.md` for front-end modules
- `backend.<module-name>.md` for back-end modules

Each module file is written as a “factory tour” narrative and includes enough context to stand alone when copied into an issue, PR, or AI troubleshooting thread. The point is that an engineer should be able to open any single module tour and understand:

- where work enters the module,
- what objects move through it,
- what normal progress looks like,
- what abnormal progress looks like,
- what to inspect next.

## Module index

### UI modules

- `ui.application-shell.md`
- `ui.capture-experience.md`
- `ui.session-list-experience.md`
- `ui.session-detail-experience.md`
- `ui.settings-mode-experience.md`
- `ui.diagnostics-experience.md`

### Backend modules

- `backend.capture-domain.md`
- `backend.session-storage-domain.md`
- `backend.analysis-domain.md`
- `backend.playback-slicing-domain.md`
- `backend.transcription-domain.md`
- `backend.settings-domain.md`
- `backend.logging-visibility-domain.md`

## How to use this folder during debugging

Start from the failing user flow and map it to the module list. Turn on instrumentation only for the modules that sit on that flow segment. Read the relevant module tours before digging into logs so you know which events are expected, which are optional, and which are red flags. Then filter logs by module key and event family to avoid drowning in unrelated activity. When sharing context with AI, include the module tour name, the filtered logs, and a short statement of what behavior you expected versus what happened.

If a debugging incident reveals that a module tour is incomplete or inaccurate, update that module file first, then update the higher-level visibility summary if needed. This preserves the intended hierarchy: module tours are the concrete operational truth; summary docs are the cross-module abstraction.
