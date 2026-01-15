# Web Whisper Capture Documentation Hub

Welcome to the technical documentation hub for the capture pipeline powering Web Whisper. This directory expands on the high-level specification (`documentation/spec/20251106-031710_capture-refinement.md`) with deep dives that assume no prior knowledge of audio engineering or browser media APIs. You will find:

- `technology.md` – a friendly primer on the pieces the browser provides (MediaStream, MediaRecorder, Blob, etc.) and how they relate to PCM audio samples.
- `pcm-walkthrough.md` – a middle-school-level explanation of what Pulse-Code Modulation is, how samples are buffered, and why AAC/MP4 “init segments” exist.
- `libraries.md` – an inventory of the modules, classes, and functions in this repository, with guidance on how they collaborate during a recording session.
- `capture-flow.md` – a chronological walkthrough from the moment the user hits “Start” until the recorder is cleaned up, including event sequences, threading considerations, and timing heuristics.
- `debugging.md` – practical guidance on reading the in-app developer console, interpreting new log messages, and verifying chunk metadata.

Each document links out to relevant public resources (MDN, Wikipedia, W3C) so you can explore deeper background material without leaving this repository. Start with `technology.md` if you are new to browser audio capture, then follow the links in that document to progress through the full capture lifecycle.
# Project Status — Durable Audio Recorder PWA

This document tracks the real-world readiness of core capabilities. Status is intentionally blunt so we keep honest about what works today.

| Feature | Status | Notes |
| --- | --- | --- |
| Installable PWA shell | 🟩 Ready | Scaffolding, theming, and service worker registration verified. |
| Continuous capture tee | 🟨 In progress | Continuous MediaRecorder capture + fixed snips working; AudioWorklet analysis still pending. |
| Chunk persistence & durability | 🟨 In progress | IndexedDB manifest persists chunks with deterministic timing verification; upload/backoff plumbing still outstanding. |
| Recording playback | 🟨 In progress | Combined chunk playback available; needs waveform scrubber & buffering polish. |
| Adaptive snip logic | 🟨 In progress | Snip segments derived from chunk volume profiles and surfaced in the detail debug panel; AudioWorklet/live metrics still pending. |
| Live transcription | 🟨 In progress | Manual snip transcription via Groq; live streaming still simulated. |
| Settings & Groq key intake | 🟨 In progress | Groq key now powers snip retry transcription; live streaming still pending. |
| Telemetry & safeguards | 🟥 Not implemented | Offline, low-storage, and device-change handling TBD. |
| Spec + prompt logging | 🟩 Ready | `documentation/spec/` entries created per session; prompt transcripts stored alongside specs. |

## Current Focus

- Wire the AudioWorklet analysis tee, adaptive snip heuristics, and diagnostics surfaced via developer mode.
- Build the uploader worker with retry/backoff plus UI affordances for recovery and attention states.
- Extend Groq transcription from manual snip retries into automatic streaming updates.

## Upcoming Milestones

1. **Analysis & Snip Intelligence** — wire AudioWorklet metrics, adaptive boundaries, and session diagnostics.
2. **Uploader & Retry Loop** — background worker, HTTP retry/backoff, and storage pressure safeguards.
3. **Transcription Integration** — settings flow for Groq API key, 30-second batching, and retry controls on the session detail view.

Refer to `documentation/spec/` for iteration-by-iteration breakdowns and prompt transcripts.

## iOS Microphone Permissions

- iOS currently prompts on every launch of a standalone PWA when requesting `getUserMedia`. To minimise prompts, open **Settings → Safari → Microphone** and ensure “Allow” is selected. If the PWA still prompts, grant access when asked—the browser does not persist the choice for installed PWAs yet.
