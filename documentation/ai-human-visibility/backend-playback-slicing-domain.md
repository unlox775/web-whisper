# Factory Tour: backend.playbackSlicingDomain

Welcome to the playback slicing domain. If the capture domain is where raw material is produced and the storage domain is where that material is warehoused, this module is the precision cutting station where humans ask for specific segments and expect correct playable results every time. This module matters because “I can play exactly what I intended” is both a user trust requirement and a debugging truth requirement. When humans are chasing a transcript mismatch, a silence gap, or a timing drift, this is often where uncertainty becomes visible.

The job here is deceptively simple at product level and deeply nuanced at runtime level. The product-level ask is “play this chunk,” “play this snip,” or “give me the range from start to end.” But runtime reality includes offset normalization, chunk overlap handling, varying decode quality, purged-audio constraints, and the need to return deterministic slices even as storage retention changes what is still physically available. The module acts like a machinist that can take an abstract coordinate request and map it into actual available audio bodies with accurate boundaries.

Historically, modules like this become brittle when they assume ideal data. In real systems, historical sessions can include edge artifacts, off-by-one boundaries, variable decode latencies, and inconsistent metadata quality. The visibility strategy is therefore not only about performance timing; it is about proving that the mapping from logical range to physical bytes remains coherent under imperfect conditions.

## Mechanism story

The module receives a request expressed in domain timing (chunk index, snip index, or explicit time range). It then resolves the relevant stored chunk data, normalizes timing references to a stable base, identifies the intersection between requested range and available chunk spans, decodes only the required overlap windows, and reassembles a single playable output artifact for the caller. The output may be an existing chunk blob, a synthesized range slice, or a transformed audio blob suitable for downstream actions such as transcription.

This pipeline behaves like a conveyor system with quality gates:

1. resolve request scope,
2. map request to candidate chunks,
3. decode and slice overlapping segments,
4. concatenate in deterministic order,
5. emit output plus inspection metadata.

Every gate can fail for different reasons, so visibility has to retain gate-level event semantics instead of flattening all outcomes into one generic “playback failed” message.

## Why this module is tricky

The first difficulty is timebase correctness. Session data can represent timing relative to session start while some legacy or absolute fields may encode wall-clock offsets. If the module does not normalize consistently, slices can drift or clip unexpectedly.

The second difficulty is overlap and boundary precision. When request boundaries cut through chunk interiors, the module must decode enough data for correctness while avoiding expensive full-session decode. A tiny boundary error can produce audible clicks, missing words, or transcript misalignment.

The third difficulty is retention interaction. Some chunks may be present only as metadata while payloads were purged. The module has to signal unavailability clearly and avoid pretending a slice exists when its source bytes are gone.

The fourth difficulty is decode variability. Browser decode behavior may vary by codec edge cases and payload structure. Visibility therefore must capture decode duration, failure class, and fallback pathways rather than hiding decoder fragility behind a generic exception.

## Signals to watch

Use these event groups as the default inspection model:

- request lifecycle: `playback.request.received`, `playback.request.classified`
- source resolution: `playback.sources.resolved`, `playback.sources.missing`
- overlap computation: `playback.overlaps.computed`
- decode lifecycle: `playback.decode.start`, `playback.decode.done`, `playback.decode.error`
- slice assembly: `playback.assembly.start`, `playback.assembly.done`
- output emission: `playback.output.ready`, `playback.output.unavailable`

Key payload fields should include request type, start/end range, candidate chunk count, overlap segment count, decode ms, output duration ms, and unavailability reason when applicable.

## Healthy sequence example

A healthy range playback sequence usually looks like this: request received with explicit boundaries, sources resolved with at least one playable overlap, overlap map computed with non-zero duration, decode starts and completes for each overlap segment within reasonable latency, assembly produces contiguous output duration close to requested window, output ready event emitted with final blob metadata.

For chunk playback, the healthy path is shorter: request classified as direct chunk retrieval, chunk source resolved, payload availability verified, output ready emitted. For snip playback, healthy sequence is similar to range playback but with precomputed segment boundaries from snip records.

## Failure cues and likely causes

If `playback.sources.missing` appears before overlap computation, likely causes include stale references, deleted sessions, or retention-purged payloads. If overlap count is zero despite valid request boundaries, suspect timebase mismatch or incorrect normalization. If decode errors spike for one MIME family, suspect codec fragility or malformed blob content.

If assembly completes but output duration is far below request duration, inspect overlap trimming logic and boundary rounding behavior. If output is ready but user hears silence, inspect per-segment RMS/inspection metadata and retention flags.

## Human debugging route

When humans suspect playback slicing issues, the first step is to reproduce with a concrete request type: direct chunk, known snip, then arbitrary range crossing chunk boundaries. This progression reveals whether the fault is global decode, mapping logic, or range assembly.

Then inspect the event chain in order, not just final errors. Confirm candidate source count, overlap map, and decode outcomes. For range-specific bugs, compare requested duration to assembled duration and identify where time was lost.

If the issue is intermittent, compare two sessions: one healthy, one failing. The diff should be done at event-field level rather than raw logs only. The goal is to identify which gate diverges first.

## AI collaboration posture

For AI-assisted debugging, export compact traces with request boundaries, source counts, overlap stats, decode timings, and final duration delta. Avoid dumping full binary metadata. AI should be able to infer whether failures originate in source availability, time normalization, decode behavior, or assembly logic.

When requesting AI help, include:

- request type and target boundaries,
- source resolution outcome,
- overlap and decode summary,
- output duration vs expected duration,
- retention/purge state for involved chunks.

This structure keeps reasoning efficient and reduces hallucination risk by constraining interpretation to gate-level evidence.

## Performance and safety notes

This module can become expensive if it over-decodes. In non-verbose mode, event detail must remain concise while preserving gate outcomes. Verbose mode can include per-overlap details for deep analysis. Off-mode instrumentation should have negligible overhead and never alter slicing behavior.

The module should fail transparently: if output cannot be produced because sources are missing, emit explicit unavailability reasons and preserve downstream flow stability. Silent fallback to empty output is unacceptable because it hides root causes and misleads operators.

## Adherence markers

This module is near ideal when:

- request-to-output paths are deterministically observable,
- time normalization mismatches are detectable early,
- decode failures are categorized and actionable,
- retention interactions are explicit,
- output duration alignment is measurable and reliable.

If those markers are not met, recommended refactors should prioritize normalization clarity, overlap diagnostics, and decode failure taxonomy before chasing UI-level workarounds.

