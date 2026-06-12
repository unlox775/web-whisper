# Factory Tour: `ui.capture-experience`

Welcome to the capture floor. If the application is a working factory, this module is the front gate where intention becomes motion. Users don’t think in terms of buffers, encoders, and storage transactions when they press Start. They think, “I asked the app to begin recording; I need confidence that it is really recording.” This module exists to preserve that confidence from the first gesture to the final Stop.

The history and context of this module are straightforward but important: recording interfaces often fail in subtle ways. A button can switch state before microphone access is secured. A warm-up spinner can hide a stalled initialization path. A cancellation affordance can appear too late to help. People lose trust quickly when “recording” looks active but no durable artifact is actually being produced. So this module’s first responsibility is not cosmetic. Its first responsibility is truthful user state.

In this architecture, `ui.capture-experience` is responsible for translating user intent into visible status transitions that align with backend reality. It is not the owner of audio data and not the owner of persistence logic. Instead, it presents and validates transitions such as idle -> starting -> recording -> stopping -> idle (or error). Think of it as the control room console that mirrors the state of heavier backend machinery in language humans can act on.

The module’s core narrative starts with intent entry. A user action asks to start or stop recording. The UI module emits explicit action signals and enters a provisional state immediately, but it remains honest about uncertainty until backend confirmation arrives. If backend modules indicate capture is live, the UI transitions to an active recording posture and starts rendering in-session confidence indicators. If backend modules report failure, this module must surface error context in user-safe language and provide a clean path back to idle.

The second part of the narrative is warm-up integrity. Warm-up is not a decorative delay; it is an uncertainty interval where multiple dependent operations may fail. This module should surface that uncertainty as a controlled, bounded state. It should also expose cancellation options when warm-up exceeds user expectations. In observability terms, warm-up is where many “silent failures” hide, so timeline precision here is essential.

The third part is in-session confidence. Once recording is active, the user needs reinforcement that the system is still healthy. This module should display elapsed context, visible activity cues, and any critical warnings forwarded from backend diagnostics. It should not invent backend health. It should render only what contracts confirm. If backend contracts report no audio callback or delayed chunk persistence, this UI should surface concern rather than pretending all is normal.

The fourth part is stop/finalization posture. Stop is often treated as trivial in UI design, but architecturally it is another uncertainty interval. Data may still be flushing. Session summary values may still be reconciling. The UI should communicate that the system is finishing work, then transition to a completed/ready posture only when finalization is actually done. If finalization fails, this module should preserve user context and direct attention to actionable next steps.

## Why this module is tricky

The trickiness of `ui.capture-experience` comes from asymmetry between user expectations and backend timing. Humans expect binary outcomes (“recording now” versus “not recording”), while backend operations are staged and can fail between phases. This creates several failure classes: false-positive active states, missing cancellation windows, delayed error surfacing, and post-stop ambiguity. Observability that only records “button clicked” cannot explain these failures.

Another tricky point is state synchronization drift. If UI state transitions are optimistic and backend confirmation is delayed or reordered, the timeline may become contradictory. A user may see recording while backend state is still acquiring permissions. Or the UI may return to idle before backend flush completion. The module’s instrumentation must therefore preserve causality: what user requested, what backend acknowledged, and what UI rendered in response.

A third difficulty is balancing reassurance with noise. Overly chatty UI status updates can create perceptual instability, while sparse updates hide critical context. The module needs a disciplined event model that captures transitions and notable timing boundaries without flooding logs with rendering minutiae.

## Signals to watch

The module should emit a compact but expressive event sequence. Suggested signals include:

- `ui.capture.intent.start`
- `ui.capture.intent.stop`
- `ui.capture.state.enter.starting`
- `ui.capture.state.enter.recording`
- `ui.capture.state.enter.stopping`
- `ui.capture.state.enter.idle`
- `ui.capture.warning.start-timeout`
- `ui.capture.warning.no-audio-indication`
- `ui.capture.error.surface`
- `ui.capture.cancel.requested`
- `ui.capture.cancel.completed`

These events should include session context, timestamps, and a lightweight reason field where appropriate. They should not include bulky payloads that belong to backend diagnostic channels.

## Healthy sequence example

In a healthy run, the module timeline looks like this in plain language: user requests Start, UI enters starting, backend confirms live capture, UI enters recording, user requests Stop, UI enters stopping, backend confirms finalization complete, UI enters idle. If this sequence occurs with expected timing and no warning/error events, the capture floor is healthy.

## Failure cues and likely causes

If `ui.capture.state.enter.starting` appears without a subsequent recording confirmation within expected thresholds, suspect permission flow stalls, device acquisition issues, or backend startup dead zones. If warnings about no audio appear while UI remains in recording for long periods, suspect upstream signal path problems or callback starvation. If stopping persists unusually long before idle/ready rendering, suspect flush queue pressure or finalization contention in persistence layers.

A key debugging heuristic: whenever capture UI and backend capture state disagree, treat that as a synchronization defect first, not a cosmetic defect. User trust depends on this module being a truthful guide, not a hopeful narrator.

## Operational guidance for human + AI debugging

When triaging capture complaints, run a “small tour” through this module first. Confirm whether the state ladder is coherent. Confirm whether warnings appear at meaningful points. Confirm whether cancellation behavior is offered and acted on. Then pivot to backend capture and storage tours with the same session scope. AI assistance is most useful when this module provides clean state transition breadcrumbs because those breadcrumbs sharply reduce search space in downstream logs.

If this module is instrumented well, a human should be able to answer three critical questions quickly: Did the app recognize user intent? Did it represent runtime uncertainty honestly? Did it close the session lifecycle in a way users can trust? That is the standard for this floor.

