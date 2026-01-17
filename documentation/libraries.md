# Code Modules and Responsibilities

Audience: engineers stepping into the codebase. This document summarizes the primary modules, classes, and helpers.

## 1. Capture (`src/modules/capture/controller.ts`)

| Element | Type | Purpose |
| --- | --- | --- |
| `PcmMp3CaptureController` | class | PCM capture, MP3 encoding, chunk persistence. |
| `captureController` | singleton | Exported instance used by `App.tsx`. |
| `start(options)` | method | Builds AudioContext graph and begins PCM processing. |
| `stop()` | method | Flushes remaining PCM and reconciles the session. |

Key behaviors:
- Converts Float32 PCM to Int16.
- Flushes chunks at a target sample count.
- Uses sample counts to compute deterministic timing.

## 2. MP3 encoder (`src/modules/capture/mp3-encoder.ts`)

| Element | Type | Purpose |
| --- | --- | --- |
| `ensureMp3EncoderLoaded()` | function | Loads the Lame.js browser bundle. |
| `getMp3EncoderCtor()` | function | Returns the MP3 encoder constructor. |

## 3. Manifest + storage (`src/modules/storage/manifest.ts`)

| Element | Type | Purpose |
| --- | --- | --- |
| `ManifestService` | interface | IndexedDB CRUD for sessions, chunks, snips, and logs. |
| `IndexedDBManifestService` | class | `idb`-based implementation. |
| `appendChunk()` | method | Stores chunk metadata and blob, updates session totals. |
| `verifySessionChunkTimings()` | method | Rebuilds sequential timing using verified durations. |

## 4. Volume profiling (`src/modules/storage/chunk-volume.ts`)

| Element | Type | Purpose |
| --- | --- | --- |
| `computeChunkVolumeProfile()` | function | Decodes a chunk and produces normalized frames. |

## 5. Analysis (`src/modules/analysis/*.ts`)

| Element | Type | Purpose |
| --- | --- | --- |
| `analyzeSessionFromFrames()` | function | Produces quiet regions and snip proposals. |
| `SessionAnalysisProvider` | class | Builds analysis timelines and caches results. |

## 6. Playback slicing (`src/modules/playback/recording-slices.ts`)

| Element | Type | Purpose |
| --- | --- | --- |
| `RecordingSlicesApi` | class | Chunk playback, snip playback, and range decode. |
| `getChunkAudio()` | method | Returns a playable blob for a specific chunk. |
| `getRangeAudio()` | method | Produces a WAV slice for a time range. |

## 7. Transcription (`src/modules/transcription/service.ts`)

| Element | Type | Purpose |
| --- | --- | --- |
| `transcriptionService` | singleton | Groq Whisper integration for snip audio. |
| `transcribeAudio()` | method | POSTs audio to Groq and normalizes the result. |

## 8. Settings + logging

| Module | Purpose |
| --- | --- |
| `src/modules/settings/store.ts` | Persists Groq key, developer mode, and storage limit. |
| `src/modules/logging/logger.ts` | Structured logs stored in IndexedDB. |

## 9. UI shell

| Module | Purpose |
| --- | --- |
| `src/App.tsx` | Orchestrates capture, playback, diagnostics, and transcription flows. |
| `src/components/RecordingAnalysisGraph.tsx` | Histogram and snip visualization. |
