# Factory Tour: backend.session-storage-domain

Welcome to the factory tour for the Session Storage Domain module, the part of the system that behaves like the warehouse, records office, and historical ledger combined. If the capture module is a line that turns live signal into chunks, this storage module is where those chunks become reliable facts. It owns persistence durability, object shape continuity, retention effects, pagination interfaces for diagnostics, and session-scoped logging archives. In practical debugging work, when humans ask, “What is true right now?” this module is almost always the final source of truth.

One reason this module deserves a deep, story-style tour is that storage issues frequently appear as UI issues. A list may look wrong, previews may feel stale, playback may fail, or retention may look inconsistent. In many of those cases, the visible symptom is downstream. The actual root cause is often in storage semantics: timing mismatch, missing object update, unpruned stale row, inconsistent purge marker, or partial transaction outcome. So the purpose of this module’s visibility strategy is to help humans and AI assistants trace object lifecycle and transaction behavior with high confidence.

## History and context for this module

This domain evolved from a simple persistence role into a broad responsibility center because the application needed durability and introspection at the same time. The module now owns sessions, chunks, chunk-volume profiles, snips, log sessions, and log entries. It also owns helper capabilities such as retention policy execution and timing verification workflows. These are not arbitrary extras. They emerged because long-running capture and post-processing systems create correctness risks that cannot be solved at rendering time.

Historically, the most important lesson in this module is that reads and writes are as much part of runtime behavior as capture and playback. A storage module is not just “where data sits.” It is a dynamic subsystem that can become a performance bottleneck or correctness bottleneck depending on access patterns and object lifecycle design. That is why observability for this module must track operation intent, payload shape at summary level, transaction durations, and resulting object-state changes.

## Mechanism story: how the storage factory floor operates

The storage factory floor can be visualized as a set of lanes that share one controlled floor manager. The lanes represent object stores for sessions, chunks, chunk profiles, snips, and logs. Each operation enters with a declared intent—create session, append chunk, list sessions, patch snip transcription, run retention, verify timings, inspect tables. The floor manager opens scoped transactions to avoid unbounded side effects, then writes or reads objects through indexed paths where possible.

During active capture, new chunk records and blob payloads are appended repeatedly. The module also updates session summary values so high-level list views do not need full rescans every time. Analysis and transcription flows then write derivative objects (profiles and snips), and later patch transcription fields. Retention flows can mutate object payload availability while preserving object identity and historical context. Diagnostics flows read and paginate object stores for human inspection and reporting.

The important mechanism detail is that this module is not single-purpose I/O. It orchestrates object lifecycle transitions across multiple stores in ways that downstream modules assume are coherent. If one lane drifts from expected semantics—for example, snip metadata updates but session summary lags—higher layers become confusing even when no exception is thrown. Visibility must therefore emphasize cross-store coherence, not just isolated read/write success.

## Why this module is tricky

The first tricky characteristic is mixed workload pressure. The same module handles hot-path writes during capture, moderate-frequency updates during analysis and transcription, and potentially heavy reads during startup hydration or diagnostics. The second tricky characteristic is object coupling by meaning rather than foreign-key enforcement. Sessions, chunks, snips, and profiles are logically linked and must stay behaviorally consistent even when physically updated in separate operations.

A third complexity comes from retention behavior. Retention can deliberately remove payload mass (for example, audio data) while leaving object skeletons, references, and summary meaning intact. That is correct behavior, but only if downstream consumers understand what purged state means and visibility logs show the transition clearly. Without transparent retention events and object flags, users can interpret expected purges as corruption.

A fourth complexity is timing verification. Session and chunk timing coherence is a cross-object invariant. If verification status or verified durations drift, playback and analysis surfaces can appear broken. This is exactly the type of problem where a naive “method called/method returned” log pattern is insufficient. Humans need state transition narratives: what was verified, what was missing, what was updated, and what remains unresolved.

## Signals to watch in this module

Visibility signals should include operation family, object counts, affected IDs summaries, transaction duration, and mutation outcomes. The event sequence should tell a story humans can reason about quickly. For example, listing sessions should emit read scope, row counts, map/sort phases, and completion timing. Appending chunk should emit chunk identity summary, session aggregate update summary, and any profile-store side effects when applicable.

Retention events should include before/after byte posture, purged object counts, and updated session IDs. Verification events should include missing-chunk IDs counts, updated-chunk IDs counts, resulting status, and whether session-level timing status changed. Developer inspection events should include table name, page boundaries, row counts, and hasMore posture so humans can distinguish pagination behavior from data absence.

Noise handling is essential. High-frequency capture writes can overwhelm logs if each detail is verbose. Non-verbose mode should use aggregate summaries per time window or operation group where possible. Verbose mode can expose richer payload samples, but default developer workflows should remain navigable with module filters and event-family filters.

## Healthy sequence example: from capture append to stable list read

A healthy sequence begins when capture appends a new chunk. Storage receives append intent, writes chunk payload and metadata, updates session summary counters, and commits transaction. Shortly after, list hydration asks for sessions; storage returns sorted summaries with expected timing status normalization and count parity. If preview hydration requests batched snips, storage serves indexed reads with bounded transaction timing. No stale read anomalies appear, and row counts are coherent across stores for the same session.

A second healthy sequence example occurs during retention pass. Storage logs pass start with limit and current totals, evaluates candidate objects, purges eligible payloads, updates affected session summaries, marks purged references where required, and emits completion with before/after metrics plus purged IDs counts. Downstream views then show reduced payload availability without losing object identity or timeline continuity.

## Failure cues and likely causes

If session list appears delayed while storage read events show large full-store scans, the likely cause is read pattern inefficiency or contention with other transactions rather than UI rendering alone. If snip preview counts mismatch snip records in raw inspection, likely causes include stale pruning logic, incomplete patch writes, or race conditions between read chunks and subsequent state merges. If retention reports successful purges but user-facing byte posture does not move, suspect summary-update lag or inconsistent session total recalculation.

Timing verification failures with non-empty missing IDs usually indicate missing profile records or chunk metadata gaps. If verification frequently flips between states, investigate lifecycle ordering between profile generation and verification trigger conditions. If developer table pagination appears to “lose” rows intermittently, inspect page offset calculations and cursor continuation behavior before assuming corruption.

For debugging triage, this module should usually be isolated with backend-only filtering first, then correlated with one upstream module at a time (capture, analysis, playback, or transcription). That prevents mixed-noise interpretation and lets humans form stronger causal hypotheses.

## Practical tour-guide workflow

When giving a human an operational tour, begin with session object truth, then chunk and snip coherence, then retention/verification state, then diagnostics pagination and log-session archives. Explain not only what is present but what absence means. For example, no snips might mean analysis not yet run, not necessarily failure. Purged chunk payloads might mean policy compliance, not data loss bug. The tour should always connect object state to flow stage.

The module earns trust when its logs and object views make these interpretations straightforward. If humans repeatedly need to infer hidden semantics, visibility quality is inadequate even if code correctness is high.

