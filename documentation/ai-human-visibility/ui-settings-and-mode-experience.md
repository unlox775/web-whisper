# Factory Tour: UI Settings and Mode Experience (`ui.settings-and-mode-experience`)

Welcome to the settings and mode control floor. This module often looks simple from the outside: open settings, change a value, close settings. In reality, this module is one of the system’s contract enforcement points. It decides which capabilities are enabled, which are visible, and which are deliberately hidden. It is where user intent about policy becomes runtime behavior across the rest of the application.

Historically, teams tend to under-document this area because it feels like “just preferences.” That is a mistake. Settings are not passive values; they are active levers that can alter transcription eligibility, storage behavior, developer-mode affordances, and observability posture. When settings behavior is unclear, debugging becomes ambiguous because nobody can confidently answer whether the system was operating under the policy assumptions they thought were active.

In this architecture, the settings and mode experience should be treated as a gatekeeper module that translates human policy decisions into explicit runtime state transitions. It should never behave like a magical side channel where hidden flags appear unexpectedly. A human should be able to inspect current settings state, understand what each setting controls, and predict which modules will respond to that setting change.

From a factory tour perspective, think of this module as the control room that configures how the rest of the factory runs. The control room does not perform the heavy transformations itself, but it sets guardrails and operating modes for those transformations. If the control room is misconfigured or silently inconsistent, even perfectly healthy downstream modules can look broken.

The core responsibility of this module is to maintain coherent policy state across four major concerns: user configuration, external-service readiness, developer tooling visibility, and safety defaults. User configuration includes settings such as storage limits and operational preferences. External-service readiness includes credential posture for transcription and validation lifecycle state. Developer tooling visibility includes whether debug controls appear at all and which instrumentation surfaces become interactive. Safety defaults include fallback behavior when settings are missing, malformed, or partially updated.

This module must be very explicit about state transitions. If a user adds a service key, the module should emit a clean transition from missing to validating to valid or invalid. If developer mode is switched on, the module should emit a mode-change event that downstream UI modules can react to predictably. If storage limits are changed, policy-change events should be emitted clearly enough that retention behavior can be traced back to user action rather than inferred after the fact.

One subtle complexity here is timing. Settings can hydrate asynchronously at startup while other modules are already preparing to run. This means the module needs to make startup posture observable. If a module downstream behaves differently before and after settings hydration, humans need a clear event trail showing when policy became authoritative. Without that timeline, debugging startup issues can devolve into contradictory narratives about which policy values were active at which point in time.

Another subtle complexity is error semantics around credential validation. A key can be missing, pending, invalid, or valid. Those are not cosmetic labels; they imply real capability states in the app. The settings module must separate these states cleanly and expose them as inspectable evidence. For AI-assisted diagnosis, this is especially important because many user-reported failures are policy-state failures in disguise: transcription appears “broken,” but the real issue is unresolved or invalid credential posture.

This module also owns an important social contract: developer mode should be explicit and reversible. Debug tooling should not leak into normal user workflows by accident. Enabling developer mode is a conscious shift into inspection posture. Disabling it should return the interface to normal posture without leaving stale debug side effects. If that transition is not robust, users can lose trust in both the UI and the observability layer.

## Why this module is tricky

The tricky part is not rendering controls; it is maintaining policy coherence under asynchronous and partial state updates. Setting changes can arrive at startup, from user actions, and from validation responses. If those updates race or interleave without clean event semantics, downstream modules can temporarily operate under inconsistent assumptions. That creates bugs that are hard to reproduce and easy to misattribute.

## Signals to watch

Watch for events that describe policy lifecycle rather than raw input changes. Healthy instrumentation should include:

- settings hydration started/completed
- settings value changed (with safe summary, not secret payload)
- developer mode toggled on/off
- credential validation started/completed/failed
- capability posture changed (for example transcription blocked/unblocked)
- storage policy changed and propagated

These events should include enough context to reconstruct causality: what changed, when it changed, and what capability impact followed.

## Healthy sequence example

A healthy startup sequence usually looks like this: settings hydration starts, persisted values are loaded, effective policy state is published, and dependent modules acknowledge readiness under that policy. If credentials are present but unvalidated, validation starts and resolves to a clear outcome. If developer mode is enabled, debug affordances become visible only after mode transition is confirmed.

A healthy user-change sequence usually looks like this: user updates a setting, module emits a settings change event, effective policy recalculates, capability state updates, and dependent modules react. The key property is monotonic clarity: each step should be observable and the order should make sense.

## Failure cues and likely causes

If capabilities appear to flicker between enabled and disabled, suspect racing hydration/validation state or missing transition guards. If developer controls appear inconsistently, suspect stale mode state, partial rendering gates, or delayed propagation events. If storage behavior does not match user-configured limits, suspect policy propagation gaps between settings change and retention evaluation.

If users report “it says enabled but still won’t run,” inspect credential posture transitions and capability-state events first. If the module logs only final outcomes and not transition steps, add intermediate lifecycle events immediately; otherwise, failures will continue to look random even when they are deterministic.

## Tour guide summary

This module is the factory’s control room. It does not make the product’s core artifacts directly, but it determines the operating mode under which every other module runs. Treating it as a first-class, observable domain dramatically improves troubleshooting quality because many apparent downstream failures are actually policy-state failures upstream.

When this module is healthy, the rest of the system operates under explicit, auditable conditions. When it is weak, every module can appear intermittently unreliable even if their core logic is sound. That is why this tour goes deep: policy clarity is operational reliability.

