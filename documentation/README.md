# Web Whisper Documentation Hub

This folder contains the living documentation for Web Whisper. It is kept current with the codebase and separated from historical notes.

- `documentation/spec/` holds session-by-session specs and prompt transcripts.
- `documentation/ZZ_history/` holds archived docs with date prefixes.

## Core docs
- `architecture.md` - current system overview and data flows.
- `technology.md` - browser API primer and PCM-first capture path.
- `pcm-walkthrough.md` - PCM basics and why we encode to MP3.
- `capture-flow.md` - runtime timeline from start to stop.
- `libraries.md` - module map and responsibilities.
- `debugging.md` - developer tooling, logs, and diagnostics.
- `lessonslearned.md` - retrospective and timeline.
- `roadmap.md` - final polish roadmap and acceptance criteria.
- `knownissues.md` - known bugs and platform limitations.
- `contributor-roadmap.md` - optional community contributions.

## Project Status - Durable Audio Recorder PWA

| Feature | Status | Notes |
| --- | --- | --- |
| Installable PWA shell | Ready | Service worker and PWA packaging verified. |
| PCM capture + MP3 chunking | Ready | AudioContext + ScriptProcessor + Lame.js. |
| Chunk persistence | In progress | Durable local storage; retention policy still pending. |
| Recording playback | Ready | Full session playback and chunk/snip playback. |
| Analysis + snip segmentation | In progress | Heuristics tuned iteratively from volume profiles. |
| Groq transcription | In progress | Snip-based transcription with API key required. |
| Developer diagnostics | Ready | IndexedDB tables, logs, and doctor tests. |
| Telemetry + uploads | Not implemented | No uploader or telemetry pipeline yet. |
| Spec + prompt logging | Ready | `documentation/spec/` is the canonical log. |

## Current Focus
- Improve retention policies and storage cap enforcement.
- Clarify transcription onboarding, key validation, and disabled-mode UX.
- Add clipboard-first transcription UX for completed sessions.
- Run a cross-browser compatibility pass and document blockers.

Known issues live in `documentation/knownissues.md`.

## Upcoming Milestones
1. iOS native wrapper for background recording reliability.
2. Automatic retention and deletion for completed snips.
3. Full-session audio download and transcription onboarding polish.
4. Clipboard-first transcription UX for faster copy.
5. Cross-browser test matrix with targeted fixes.
