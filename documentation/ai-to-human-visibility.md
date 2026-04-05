# AI-to-Human Visibility Layer

This document defines the target debugging and observability experience for the application in domain terms. It describes how humans and AI assistants should inspect behavior safely and effectively without depending on current file layout.

It is governed by:

- `documentation/AI-Modulization-Standard.md`
- `documentation/flows-and-parts.md`

---

## 1) Document contract

This document must answer, for each major part/module:

1. What can be instrumented?
2. What events are emitted?
3. How noisy are those events?
4. What persisted objects can be inspected?
5. How can evidence be filtered and exported for AI collaboration?

It should remain valid even if implementation structure changes.

---

## 2) Visibility goals

1. **Tourability:** A human can walk the critical, secondary, and tertiary flows and see what happened step by step.
2. **Targeted control:** Visibility can be enabled per front-end part and per back-end module.
3. **Persistent evidence:** Logs and object snapshots survive reloads and can be reviewed by session.
4. **Noise discipline:** Default mode remains low-noise; high-detail modes are explicit.
5. **AI handoff readiness:** Diagnostics can be copied/exported in bounded, structured form.
6. **Performance safety:** With debug visibility off, instrumentation overhead is negligible.

---

## 3) Visibility control model (target)

Define a unified visibility profile:

```ts
type VisibilityProfile = {
  enabled: boolean
  level: 'minimal' | 'standard' | 'verbose'
  frontEndParts: Record<string, boolean>
  backEndModules: Record<string, boolean>
  payloadMode: 'summary' | 'sampled' | 'full'
}
```

### 3.1 Activation rules

- Default user mode: visibility off.
- Developer/debug mode: visibility controls become available.
- Users can toggle individual parts/modules without enabling full-system verbosity.

### 3.2 Safety rules

- Visibility failures never block core user flows.
- Enabling visibility should not inject noisy UI changes into normal screens by default.
- Sensitive values (keys/tokens/secrets) must never be emitted.

---

## 4) Telemetry event contract

Every event should use a stable envelope:

- `eventId` (stable identifier)
- `moduleKey` (part/module source)
- `family` (`ui`, `capture`, `storage`, `analysis`, `playback`, `transcription`, `settings`, `logging`)
- `phase` (`start`, `success`, `error`, `cancel`)
- `severity` (`debug`, `info`, `warn`, `error`)
- `sessionId` when relevant
- `atMs`, `atIso`
- `elapsedMs` when timing spans are meaningful
- concise `details` payload

Prefer intent-rich events over generic method traces:

- good: `session-list.hydration.completed`
- poor: `listSessions called`

---

## 5) Module-level visibility map

Event frequencies are approximate and used to control noise.

## 5.1 Front-end parts

### A) Application Shell
- **Key events**
  - bootstrap start/done
  - settings hydration done
  - main list visibility achieved
- **Expected frequency**
  - low per app activation (about 3-10)

### B) Capture Experience
- **Key events**
  - capture toggle requested
  - capture start transition
  - capture stop transition
  - capture error surfaced
- **Expected frequency**
  - low/medium per session

### C) Session List Experience
- **Key events**
  - session list data hydration start/done
  - card open action
  - retry action requested
- **Expected frequency**
  - medium, depends on list size and interaction depth

### D) Session Detail Experience
- **Key events**
  - detail opened/closed
  - playback prepare start/done
  - snip interaction and retry actions
- **Expected frequency**
  - medium/high in active debugging sessions

### E) Settings/Mode Experience
- **Key events**
  - setting updated
  - developer mode changed
- **Expected frequency**
  - low

### F) Diagnostics Experience
- **Key events**
  - diagnostics panel open
  - diagnostics run start/done
  - report export
- **Expected frequency**
  - low/medium

## 5.2 Back-end modules

### 1) Capture Domain
- **Key events**
  - capture requested
  - stream acquired
  - chunk encoded/persisted
  - capture finalized
- **Noise note**
  - chunk-level events can be high-frequency; summarize in non-verbose mode.

### 2) Session Storage Domain
- **Key events**
  - storage init
  - list/read/write operations
  - retention pass and verification outcomes
- **Noise note**
  - avoid logging full object arrays by default.

### 3) Analysis Domain
- **Key events**
  - analysis preparation start/done
  - timing verification outcomes
  - snip derivation outcomes
- **Noise note**
  - typically medium frequency per opened session.

### 4) Playback Slicing Domain
- **Key events**
  - playback source prep start/done
  - range decode start/done/error
- **Noise note**
  - interaction dependent; can spike during diagnostics scans.

### 5) Transcription Domain
- **Key events**
  - credentials validation
  - request start/done/error
  - retry batch outcomes
- **Noise note**
  - medium/high with many snips; summarize retries.

### 6) Settings Domain
- **Key events**
  - load/update events
- **Noise note**
  - low frequency.

### 7) Logging/Visibility Domain
- **Key events**
  - log session start/end
  - write failure warnings
  - global error capture summary
- **Noise note**
  - low unless systemic errors occur.

---

## 6) Persisted object visibility strategy

Humans and AI assistants need both quick summaries and full raw access.

### 6.1 Sessions
- **Summary fields:** status, start/end posture, duration, size, timing integrity state.
- **Raw view:** full serialized record.
- **Questions answered:** Is session coherent and complete?

### 6.2 Chunks
- **Summary fields:** sequence, time range, byte size, purge state.
- **Raw view:** full metadata with binary payload omitted by default.
- **Questions answered:** Are chunk ranges monotonic and retention-consistent?

### 6.3 Analysis Profiles
- **Summary fields:** frame count, duration, average/peak measures.
- **Raw view:** full profile including frame arrays.
- **Questions answered:** Are analysis inputs complete and plausible?

### 6.4 Snips
- **Summary fields:** index, time range, transcript/error state, purge state.
- **Raw view:** full snip + transcript payload.
- **Questions answered:** Why is preview missing/partial? What is retryable?

### 6.5 Logs
- **Summary fields:** session range, entry count, severity distribution.
- **Raw view:** full event entries.
- **Questions answered:** Which phase/module consumed time or failed?

---

## 7) Log viewer requirements

### 7.1 Session model
- Log history must be session-scoped and reviewable after reload.

### 7.2 Filtering model
- Required filters:
  - module/part
  - family
  - severity
  - phase
- Users should be able to hide noisy modules without losing other context.

### 7.3 Noise controls
- Presets: `Minimal`, `Critical Flow`, `Verbose`.
- Throttling/sampling for repetitive high-frequency events in non-verbose modes.

---

## 8) AI collaboration/export model

### 8.1 Required: copy-first export
- Export selected session plus active filters.
- Include compact summary header (time range, selected modules, event totals).
- Truncate large payloads unless explicitly expanded.

### 8.2 Recommended: profile-based export
- `Compact` (chat-friendly)
- `Detailed` (engineering deep-dive)
- `Critical Flow Only` (triage-focused)

### 8.3 Future: secure retrieval model
- Optional remote retrieval can be added later, but local copy/export must always remain available.

---

## 9) Flow-oriented visibility tours

Visibility should support guided tours aligned to major flows:

- **Critical flow tour:** bootstrap -> capture -> persistence -> finalize -> playback -> transcription.
- **Secondary flow tour:** historical session selection -> snip status -> retries -> transcript convergence.
- **Tertiary flow tour:** debug mode -> object inspection -> filtered logs -> report export.

These tours should map to saved filter presets where possible.

---

## 10) Litmus checks for this document

1. Are all major parts/modules instrumentable?
2. Are event frequencies and noise risks described?
3. Can humans inspect key persisted objects in summary + raw form?
4. Can logs be filtered to isolate one failing flow?
5. Is export practical for AI collaboration without unbounded payloads?
6. Does off-mode instrumentation remain negligible?
