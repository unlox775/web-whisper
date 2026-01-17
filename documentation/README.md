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
- Harden analysis timing and snip heuristics across devices.
- Improve retention policies and storage cap enforcement.
- Refine live transcription UI and retry behaviors.

## Upcoming Milestones
1. AudioWorklet migration for lower-latency PCM capture.
2. Upload worker with retry/backoff and offline handling.
3. Streaming transcription updates with better session timelines.
