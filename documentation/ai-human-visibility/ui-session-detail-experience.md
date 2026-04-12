# Factory Tour: UI Session Detail Experience (`ui.sessionDetail`)

Welcome to the detail hall of the factory. If the session list is the loading dock where you choose a crate to inspect, the detail experience is the laboratory where you open that crate and test whether the product is truly complete. This module is where value becomes tangible. A user who reaches detail is no longer asking, "Did I record something?" They are asking, "Can I trust this artifact? Can I play it? Can I recover text from it? Can I diagnose what went wrong?"

That change in user intent is why this module is dense. It sits at the intersection of playback, analysis, snip handling, transcript lifecycle, and diagnostics tooling. If this module is under-instrumented, teams will repeatedly misdiagnose failures because many failure modes look similar at the surface: empty playback, partial transcript, missing snips, long waits, strange status pills. The detail module must turn those ambiguous symptoms into explicit, inspectable states.

## History and context

In early lifecycle products, detail views are often built as simple overlays with one or two action buttons. As features grow, the detail space tends to absorb cross-cutting concerns: diagnostics toggles, "doctor" scans, compact report exports, retry controls, per-snip playback, and retention messaging. This is natural from a product perspective because detail is where users have chosen to pay attention. But architecture-wise, it creates a pressure cooker: a lot of asynchronous behavior converges in one viewport.

This module therefore requires stronger narrative instrumentation than most UI surfaces. Logs should not merely say "detail opened" and "detail closed." They should explain readiness transitions: detail opened, metadata loaded, playback source requested, playback source prepared, analysis requested, snips refreshed, transcript state derived, diagnostics run started, diagnostics run completed. Without that sequence, humans and AI assistants cannot reliably answer whether an issue is data integrity, decode cost, retention side-effect, or remote transcription failure.

## Mechanism story

The detail experience begins when a user selects a session. The module then pivots from list-level summary state into session-specific operational state. It requests the underlying artifacts required for focused interaction: chunk metadata for timeline validity, playable ranges for transport controls, snip records for per-segment text operations, and diagnostic context for advanced troubleshooting.

Playback is not just "press play." The module must ensure that a usable playback source exists, which may involve assembling data from multiple persisted segments and accounting for purge gaps. A healthy detail module exposes this as phased state. The UI should distinguish between "playback not yet prepared," "playback preparing," "playback prepared," and "playback unavailable due to retention or corruption." Each phase should correspond to explicit events so support analysis can tell whether user complaints come from latency, decode failure, or expected unavailability.

Snip behavior in detail is similarly phased. Snips may need to be generated, refreshed, or re-read when timeline verification updates arrive. Transcript state is derived from snips, not from a single global blob. That means "empty transcript area" is not a single diagnosis. It might mean no snips yet, no transcript attempts yet, all attempts failed, or all transcript-capable audio was purged. Detail instrumentation must preserve those distinctions in event details so that debugging can stay causal instead of anecdotal.

## Why this module is tricky

This module is tricky because it combines many asynchronous branches in a user-visible place. A naive implementation can appear functional in small datasets but degrade unpredictably in large histories or on constrained devices. The user perceives one panel, but inside the panel multiple pipelines are racing: playback preparation, snip hydration, optional analysis graph generation, and possible diagnostics/report export.

Another source of complexity is mismatch between persistence semantics and user expectation. Retention policies can leave metadata intact while deleting audio bytes. The user still sees a session row and may reasonably expect playback. Detail must communicate these states clearly and log them explicitly. If not, both users and developers treat expected retention behavior as random breakage.

Finally, diagnostics actions inside detail are heavy and intentional. A doctor scan or report export can read broad evidence sets. If the module does not emit high-quality start/finish events with scope details, support sessions become guesswork. "The doctor button is slow" is not diagnosable without event-level evidence showing whether time was spent listing logs, scanning snips, decoding chunks, or serializing export output.

## Signals to watch

The following signal families should be available for this module. These are conceptual event IDs; exact naming can vary as long as semantics remain stable.

- `detail.open.requested` and `detail.open.ready`
- `detail.playback.prepare.start`, `detail.playback.prepare.done`, `detail.playback.prepare.error`
- `detail.playback.toggle.requested`, `detail.playback.state.changed`
- `detail.snips.refresh.start`, `detail.snips.refresh.done`, `detail.snips.refresh.error`
- `detail.transcript.derived` with counts (total snips, transcribed snips, failed snips, purged snips)
- `detail.diagnostics.run.start`, `detail.diagnostics.run.done`, `detail.diagnostics.run.error`
- `detail.report.export.start`, `detail.report.export.done`, `detail.report.export.error`
- `detail.close.requested`

Useful detail payload fields include: `sessionId`, `chunkCount`, `snipCount`, `playableDurationMs`, `purgedChunkCount`, `purgedSnipCount`, `diagnosticScope`, `elapsedMs`, and summarized failure reason categories.

## Healthy sequence example

In a healthy sequence, a user selects a ready session. The module emits open requested, then open ready once metadata is bound. Playback prepare starts and completes quickly, with a payload confirming a non-zero playable duration. Snip refresh runs and returns a stable count. Transcript derived emits with reasonable transcribed/total ratios. User hits play and receives state changes without transport errors. If doctor diagnostics are triggered, run start and run done events appear with bounded elapsed times and clear summary counts.

Even when no transcript exists yet, healthy behavior remains explicit. Transcript derived should still emit, but with counts indicating no transcribed snips and perhaps no errors. That keeps "not yet done" distinct from "failed."

## Failure cues and likely causes

If `detail.playback.prepare.error` appears immediately with decode-style reasons, likely causes include corrupted chunk bytes, unsupported encoding path, or stale metadata references. If playback preparation takes too long but eventually succeeds, likely causes include large session reconstruction cost or insufficient progressive preparation strategy. If snip refresh repeatedly fails while playback succeeds, likely causes include analysis pipeline mismatch rather than raw audio corruption.

If transcript derived repeatedly shows high failure counts with zero transcribed output, likely causes are remote transcription errors, credential invalidity, or retries blocked by purged audio. The payload should make these branch conditions explicit. If diagnostics export is slow or fails, inspect whether logs retrieval size is excessive or whether per-object serialization is too heavy for the current device profile.

The practical rule for this module is straightforward: every ambiguous user complaint should map to at least one explicit event family that narrows causes quickly. If a complaint cannot be mapped this way, the detail module is under-instrumented and should be considered a refactor priority.

