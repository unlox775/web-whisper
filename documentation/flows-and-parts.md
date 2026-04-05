# Flows and Parts

This document defines the application's target flows and major parts using ubiquitous language and ideal-state architecture intent. It should remain valid even if implementation files are reorganized.

The standards baseline for this document is defined in:

- `documentation/AI-Modulization-Standard.md`

---

## 1) Document contract

This document is intentionally:

- **domain-first** (what the system does for users)
- **implementation-agnostic** (not tied to current file layout)
- **evergreen** (updated when product purpose or domain model changes)

This document is intentionally not:

- a code map of where logic currently lives
- a temporary snapshot of current technical debt

---

## 2) Ubiquitous language

- **Session**: A full recording lifecycle from user start to user stop.
- **Chunk**: A durable audio segment written during a session.
- **Snip**: A meaningful subrange of a session used for targeted playback and transcription.
- **Transcript**: Text output derived from one or more snips.
- **Capture Flow**: The lifecycle that transforms microphone input into durable session artifacts.
- **Review Flow**: The lifecycle where users inspect and recover value from stored sessions.
- **Diagnostics Flow**: The lifecycle where humans inspect system behavior and evidence.
- **Developer Mode**: Explicit mode that unlocks debugging controls and visibility tools.
- **Visibility Layer**: The instrumentation and inspection surfaces that let humans and AI observe system internals safely.

---

## 3) Critical flow (primary value path)

### Critical flow: **Capture audio and produce usable text**

1. **Enter capture-ready state.**  
   The user opens the app and sees an immediately understandable capture-ready interface with current storage posture and prior session context. The application loads enough state to begin recording confidently while preparing asynchronous detail hydration in the background.

2. **Start session capture.**  
   The user starts a new session and receives immediate state feedback that capture is beginning. The system acquires recording input, initializes capture lifecycle state, and begins durable progression from live signal to persisted artifacts.

3. **Persist recording artifacts continuously.**  
   While capture is active, the system repeatedly transforms live audio into durable chunk artifacts and associated metadata needed for timeline continuity and downstream analysis. The user sees a stable in-progress experience rather than transient or fragile buffering behavior.

4. **Stop capture and finalize session integrity.**  
   The user stops recording and expects a complete, coherent session object. The system flushes pending data, reconciles session summary values, and marks session state so that playback and transcription operations can proceed with predictable semantics.

5. **Hydrate user-facing session summary.**  
   The session list reflects updated duration, size, readiness, and text preview posture. The user can immediately identify whether the new session is actionable, still processing, or needs intervention.

6. **Open session detail and verify replayability.**  
   The user opens the session and expects playback behavior aligned with recorded timeline semantics, including edge cases such as partial purge states. The system resolves slices and timeline data needed for reliable replay and interaction.

7. **Generate or retry transcript output.**  
   The user triggers transcription work and receives progress, success, or failure states at snip/session level. The system stores transcript artifacts durably and keeps retryability explicit when recoverable failures occur.

8. **Consume transcript value.**  
   The user can read, copy, and use transcript text externally. At this point, the core promise of the application is fulfilled: durable capture converted into usable textual value.

---

## 4) Secondary flow

### Secondary flow: **Recover value from historical sessions**

1. **Locate target session quickly.**  
   The user scans historical sessions by date, duration, readiness, and outcome cues to identify where attention is needed.

2. **Inspect snip-level outcome quality.**  
   The user opens detail and sees which portions are complete, partial, failed, or unavailable due to retention policy.

3. **Retry only the needed work.**  
   The user retries failed or incomplete transcript segments instead of repeating the full pipeline.

4. **Converge to usable transcript state.**  
   The session transitions to a satisfactory text state and the user resumes normal downstream usage.

---

## 5) Tertiary flow

### Tertiary flow: **Diagnose behavior and performance with evidence**

1. **Enter explicit debug posture.**  
   The user enables developer/debug mode and accesses visibility controls.

2. **Inspect persisted objects and event timeline.**  
   The user reviews key domain objects and session-scoped logs to understand what happened, where, and in what sequence.

3. **Filter noise and isolate relevant modules.**  
   The user narrows visibility to the parts/modules involved in the failing flow.

4. **Export focused diagnostics for AI collaboration.**  
   The user copies structured evidence to AI tooling for guided remediation.

---

## 6) Parts catalog (ideal architecture roles)

## 6.1 Front-end parts

### A) Application Shell
- **Role:** Entry experience, global state wiring, mode transitions, and flow orchestration.
- **Responsibilities:** Startup hydration posture, high-level routing/panel composition, global notices.
- **Contract posture:** Calls domain modules only through stable contracts.

### B) Capture Experience
- **Role:** Start/stop lifecycle interaction and live capture status communication.
- **Responsibilities:** User intent entry for capture, in-progress state display, safe cancellation messaging.

### C) Session List Experience
- **Role:** Historical session browsing and quick action entry.
- **Responsibilities:** Session status rendering, preview text posture, action affordances for open/retry/delete.

### D) Session Detail Experience
- **Role:** Deep interaction with one session.
- **Responsibilities:** Playback controls, snip navigation, transcript consumption, localized diagnostics entry.

### E) Settings and Mode Experience
- **Role:** Runtime policy/config controls for users and developers.
- **Responsibilities:** Service credentials posture, storage policy controls, developer mode gating.

### F) Diagnostics Experience
- **Role:** Human-operable debugging surfaces.
- **Responsibilities:** Module toggles, object browsers, log filters, report export actions.

## 6.2 Back-end domain modules

### 1) Capture Domain Module
- **Owns:** Recording lifecycle and durable chunk production.
- **Core contracts:** start, stop, flush, lifecycle status stream, diagnostics snapshot.

### 2) Session Storage Domain Module
- **Owns:** Durable session/chunk/snip/log object stores and lifecycle-safe mutations.
- **Core contracts:** create/update/list/read domain objects, retention enforcement, verification passes.

### 3) Analysis Domain Module
- **Owns:** Timeline and segmentation reasoning required for snip derivation and quality checks.
- **Core contracts:** prepare analysis, verify timing assumptions, produce segment proposals.

### 4) Playback Slicing Domain Module
- **Owns:** Deterministic reconstruction of replayable session or subrange audio.
- **Core contracts:** resolve chunks/snips/ranges for playback, inspection, and export.

### 5) Transcription Domain Module
- **Owns:** External transcription request lifecycle and normalized transcript artifacts.
- **Core contracts:** validate credentials, submit transcription requests, normalize/store outcomes.

### 6) Settings Domain Module
- **Owns:** User/developer runtime preferences and policy state.
- **Core contracts:** get/set/subscribe for configuration.

### 7) Logging and Visibility Domain Module
- **Owns:** Session-scoped event persistence and observability contract.
- **Core contracts:** start/end log session, append structured events, retrieve/filter/export evidence.

## 6.3 Environmental harnesses (cross-cutting plumbing)

- persistent storage engine
- browser/media runtime
- local preference storage substrate
- network transport substrate
- feature/mode gating substrate

These harnesses are dependencies used by domain modules; they are not themselves user-value domains.

---

## 7) Flow-to-parts matrix (intent-level)

- Critical flow should touch Capture, Session Storage, Playback Slicing, and Transcription domains through explicit contracts.
- Secondary flow should emphasize Session Storage + Transcription recovery semantics with clear user-level state transitions.
- Tertiary flow should rely on Logging/Visibility plus object browsing to make failures explainable.

---

## 8) Litmus checks for this document

Use these checks whenever this document is updated:

1. **Agnosticity check:** Does the doc avoid binding architecture truth to current file layout?
2. **Flow completeness check:** Does the critical flow represent full primary user value?
3. **Secondary value check:** Does at least one secondary flow represent meaningful additional value?
4. **Boundary check:** Are front-end parts and back-end domains clearly separated?
5. **Language check:** Would a new contributor understand this without opening code?

If any check fails, update this doc before or alongside implementation refactors.
