# Project Status — Durable Audio Recorder PWA

This document tracks the real-world readiness of core capabilities. Status is intentionally blunt so we keep honest about what works today.

| Feature | Status | Notes |
| --- | --- | --- |
| Installable PWA shell | 🟩 Ready | Scaffolding, theming, and service worker registration verified. |
| Continuous capture tee | 🟨 In progress | Continuous MediaRecorder capture + fixed snips working; AudioWorklet analysis still pending. |
| Chunk persistence & durability | 🟨 In progress | IndexedDB manifest persists chunks; upload/backoff plumbing still outstanding. |
| Recording playback | 🟨 In progress | Combined chunk playback available; needs waveform scrubber & buffering polish. |
| Adaptive snip logic | 🟥 Not implemented | DSP/VAD analysis module not wired; snip timing currently conceptual. |
| Live transcription | 🟥 Not implemented | UI simulates streaming text; no Groq/Whisper integration yet. |
| Settings & Groq key intake | 🟨 In progress | Settings modal persists Groq key + developer storage limits; integration pending. |
| Telemetry & safeguards | 🟥 Not implemented | Offline, low-storage, and device-change handling TBD. |
| Spec + prompt logging | 🟩 Ready | `documentation/spec/` entries created per session; prompt transcripts stored alongside specs. |

## Current Focus

- Wire the AudioWorklet analysis tee, adaptive snip heuristics, and diagnostics surfaced via developer mode.
- Build the uploader worker with retry/backoff plus UI affordances for recovery and attention states.
- Connect the stored Groq API key to the transcription flow and surface transcript retries in the detail view.

## Upcoming Milestones

1. **Analysis & Snip Intelligence** — wire AudioWorklet metrics, adaptive boundaries, and session diagnostics.
2. **Uploader & Retry Loop** — background worker, HTTP retry/backoff, and storage pressure safeguards.
3. **Transcription Integration** — settings flow for Groq API key, 30-second batching, and retry controls on the session detail view.

Refer to `documentation/spec/` for iteration-by-iteration breakdowns and prompt transcripts.

## iOS Microphone Permissions

- iOS currently prompts on every launch of a standalone PWA when requesting `getUserMedia`. To minimise prompts, open **Settings → Safari → Microphone** and ensure “Allow” is selected. If the PWA still prompts, grant access when asked—the browser does not persist the choice for installed PWAs yet.
