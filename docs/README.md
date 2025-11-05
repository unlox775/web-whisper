# Project Status — Durable Audio Recorder PWA

This document tracks the real-world readiness of core capabilities. Status is intentionally blunt so we keep honest about what works today.

| Feature | Status | Notes |
| --- | --- | --- |
| Installable PWA shell | 🟩 Ready | Scaffolding, theming, and service worker registration verified. |
| Continuous capture tee | 🟥 Not implemented | MediaRecorder + AudioWorklet pipeline still pending. Current UI uses mocks only. |
| Chunk persistence & durability | 🟥 Not implemented | IndexedDB manifest, upload queue, and retry logic remain to be built. |
| Recording playback | 🟥 Not implemented | Sessions render in UI, but no audio is persisted or played yet. Detail view is stub only. |
| Adaptive snip logic | 🟥 Not implemented | DSP/VAD analysis module not wired; snip timing currently conceptual. |
| Live transcription | 🟥 Not implemented | UI simulates streaming text; no Groq/Whisper integration yet. |
| Settings & Groq key intake | 🟥 Not implemented | Settings drawer placeholder disabled. |
| Telemetry & safeguards | 🟥 Not implemented | Offline, low-storage, and device-change handling TBD. |
| Spec + prompt logging | 🟩 Ready | `docs/spec/` entries created per session; prompt transcripts stored alongside specs. |

## Current Focus

- Restructure output directories (`pwa-public/` for deployable bundle) and initiate documentation cadence via `docs/spec` entries.
- Tighten the recordings list UI and add a detail view stub that will host playback/transcription in the MVP.
- Start scaffolding TypeScript modules for capture, storage, upload, and transcription so code has real seams for upcoming work.

## Upcoming Milestones

1. **MVP Capture Loop** — continuous AAC recording with fixed-interval snipping, IndexedDB persistence, and playback from local chunks.
2. **Transcription Integration** — settings flow for Groq API key, 30-second window batching, and retry controls on session detail view.
3. **Analysis & Durability Enhancements** — hook up AudioWorklet DSP, adaptive snip boundaries, telemetry, and offline buffering limits.

Refer to `docs/spec/` for iteration-by-iteration breakdowns and prompt transcripts.
