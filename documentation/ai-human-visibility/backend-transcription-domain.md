# Factory Tour: backend.transcription-domain

This tour covers the transcription domain as if we are standing at the speech-to-text conversion station in the application factory. This is where already-captured and already-sliced audio gets turned into language artifacts people can actually use. If capture and storage are about preserving sound, transcription is about extracting meaning from sound under real-world constraints like API availability, variable latency, partial failures, and retry policy.

This module usually looks straightforward on a diagram: send audio out, receive text back. In operational reality, it is one of the highest-friction modules because it sits at the boundary between local state and a remote AI service. That means it inherits all the complexity of network behavior, credential handling, response normalization, and user expectation management. A good visibility story here is less about “did we call the endpoint” and more about “can a human understand whether the system is making useful progress and how to recover when it is not.”

## History and context

In early-stage AI apps, transcription often starts as a direct function call with minimal wrapping: upload blob, parse result, done. That can carry a prototype surprisingly far. But once users rely on the behavior, teams discover a few recurring realities. First, not all audio segments are equal; short noisy segments, purged segments, and malformed slices all produce different outcomes. Second, not all failures are equal; credential failures, rate limits, network timeouts, and response-shape surprises require different operator guidance. Third, not all successes are equal; a technically successful response may still be semantically low-value if text is empty, poorly segmented, or mismatched to the requested range.

This is why the standard insists on mechanism-first visibility for the transcription module. Humans should be able to determine if the system is blocked at credential validation, blocked in network transit, blocked in response parsing, or blocked by local persistence update. AI assistants should be able to read exported events and infer which stage degraded. Without that stage-aware telemetry, transcription incidents become noisy user complaints with no reliable explanation path.

## How this station works in the factory

Imagine incoming snip slices as trays arriving on a conveyor belt. Each tray has metadata labels attached: session identity, snip bounds, retryability, and current transcript/error state. The transcription station inspects a tray, confirms credentials and mode posture, prepares a request package, sends it to the remote model, waits for response payload, normalizes that payload into local transcript shape, and then routes the result back into persisted snip state.

The important point is that the station itself does not own session lifecycle policy, retention policy, or playback semantics. It owns the remote text-conversion operation and the normalization of that operation into a stable local contract. If you start seeing this module making decisions about UI rendering or storage retention, that is boundary drift and should be called out by refactors.

The station also needs to support different operating tempos. Sometimes it is invoked for one snip at a time (user clicks a retry button). Sometimes it is invoked in a batch-like sequence during recovery. The visibility model should therefore include both per-request events and aggregate progress events, so humans can answer two different questions: “why did this one snip fail?” and “is the entire recovery pass converging?”

## Why this module is tricky

The tricky part is that transcription quality and reliability are the product of multiple layers that fail independently. Credentials can be wrong even when network is healthy. Network can be flaky even when credentials are valid. Response schema can evolve even when both credentials and transport are healthy. Local persistence can fail even when the model returned text successfully. Users experience all of these as “transcription is broken,” but operators need finer distinctions to respond correctly.

Another tricky area is partial success semantics. If the module returns segment data but empty aggregate text, is that success or warning? If the remote model responds successfully but the returned language metadata is missing, do we hard-fail or accept degraded output? Visibility should make these policy decisions explicit in events so a human reading the timeline can see not just that work completed, but how quality gates were interpreted.

Retry behavior is also easy to misunderstand. Blind retry loops can waste resources and increase confusion. Intelligent retry needs context from prior failures, purge state, and current credential posture. The module should expose enough telemetry that humans can distinguish “retrying with reasonable odds” from “retrying a non-retryable failure.”

## Signals to watch

The tour should treat these as narrative checkpoints, not just event names. A minimal useful progression:

- `backend.transcription.request.precheck` (credential and input posture)
- `backend.transcription.request.start` (remote call initiated)
- `backend.transcription.request.success` (remote call returned payload)
- `backend.transcription.normalize.success` (payload transformed into local schema)
- `backend.transcription.persist.success` (snip record updated)
- `backend.transcription.request.error` (remote call failed with classification)
- `backend.transcription.normalize.error` (payload parse/shape failure)
- `backend.transcription.persist.error` (local write failure)
- `backend.transcription.retry.batch.progress` (aggregate recovery movement)

Each event should carry enough detail for diagnosis without dumping full transcript bodies by default. Useful fields are request duration, remote status code class, classifier label for failure type, snip count in batch, and retry attempt index. Full payload samples should be opt-in and bounded.

## Healthy sequence example

A healthy single-snip path usually looks like this: precheck confirms credentials and snip eligibility; request starts; request returns success with non-empty body; normalization completes with stable segment structure; persistence update succeeds; UI-layer sees updated snip state and list-preview convergence. In a batch recovery path, you should see repeated single-snip successes interleaved with progress events that show decreasing failure count or increasing transcribed count.

Healthy does not require zero warnings. It is acceptable to see occasional request retries if eventual persistence succeeds and the final state converges. The key is that the sequence tells a coherent story and does not leave ambiguous “in-progress forever” states.

## Failure cues and likely causes

If precheck fails repeatedly before requests begin, look at credential lifecycle and settings propagation. If requests start but almost always fail quickly, classify transport vs authorization vs remote-service errors before touching local code. If requests succeed but normalization fails, inspect response-shape assumptions and compatibility guards. If normalization succeeds but persistence fails, inspect storage contention, schema mismatch, or transaction timing in the storage domain.

Another critical cue is mismatch between event success and user-visible state. If events report persist success but list/detail views still show stale transcription posture, the fault likely sits in UI-state hydration or preview refresh logic rather than transcription-domain execution itself.

Batch stalls are often misunderstood as model failures when they are actually policy dead-ends. For example, if many target snips are non-retryable due to purge state, retries can appear “stuck” unless progress events explicitly report skipped reasons. A good tour includes those skipped reason counts so humans can quickly decide whether to keep retrying or change retention/service settings.

## Suggested operator walkthrough

When debugging this station, start with one concrete snip and trace its path end-to-end through precheck, request, normalization, and persistence. Confirm where the first failure appears. Then move to aggregate batch view and ask whether failures cluster by one cause class or spread across multiple classes. Finally, compare module-level success events with UI-visible transcript state to ensure downstream hydration is not masking successful backend work.

The objective is not to prove the endpoint was called. The objective is to prove the module is turning eligible audio into durable text with understandable behavior under both normal and degraded conditions. If the evidence cannot answer that in a few minutes, the visibility design for this module is not yet sufficient.
