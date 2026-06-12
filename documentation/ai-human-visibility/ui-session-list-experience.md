# Factory Tour: UI Session List Experience (`ui.session-list-experience`)

The session list is where time becomes visible. If the capture experience is the moment a user creates value, the session list is where that value either feels trustworthy or questionable. People arrive at this module with practical questions, not architectural curiosity: “Did my recording save?”, “Why is this one still processing?”, “Which session is worth opening first?”, “Why is this one showing no text?” In other words, this module is the first place where confidence is either reinforced or eroded.

That is why this module should be treated as more than a rendering surface for cards. It is a state interpretation layer. It translates multiple asynchronous truths—session durability, transcript readiness, purge state, retryability, and user actions—into a compact visual language that must remain understandable under both calm and stressful conditions. A healthy list experience helps users triage quickly. An unhealthy one creates ambiguity, and ambiguity creates support burden.

In factory terms, imagine a dispatch board overlooking several conveyor lanes. Each lane corresponds to a recorded session moving through different processing stations. Some lanes are complete and labeled. Some are waiting for a downstream machine. Some are blocked by a recoverable fault. Some have had large raw materials removed due to storage policy but still retain metadata. The board operator’s job is to classify and route attention quickly. This module is that board.

## History and context of this module

In long-running recording products, list modules often start as simple indexes and then absorb operational complexity over time. The first version usually needs only title and date. The second version adds status. The third version adds preview text. Then retries, purge flags, error counts, and derived hints arrive. Without deliberate structure, this evolution creates a list that appears feature-rich but is semantically inconsistent. Two cards with the same visual state may represent different underlying causes, and users can no longer predict what action will work.

The correct response is not to remove nuance. The correct response is to narrate nuance through explicit status taxonomy and clear transitions. This module should be instrumented to prove that status transitions are coherent and that card messaging aligns with underlying object state. The tour therefore focuses on interpretation correctness, not only render timing.

## Why this module is tricky

The hard part is not mapping one state to one label. The hard part is combining several asynchronous dimensions without lying by simplification. A card can be “ready” for playback but “pending” for transcription. A session can be structurally complete while some snips are purged and non-retryable. A transient “loading preview” can be healthy for a short window and suspicious if it persists. The module must encode these distinctions without overwhelming users.

Another challenge is selective freshness. The list should become useful quickly, then progressively improve detail. That means first paint often includes partial information, and later updates fill in preview text or error counts. If this progressive hydration is not observable, humans misinterpret expected transitions as bugs. This is exactly the kind of place where AI-human visibility gives leverage: it explains why a card looks incomplete now and when that should resolve.

Finally, there is action coupling. The list is not passive; it supports opening detail, retrying transcription, and deleting sessions. If those actions are surfaced without strong state gating, users get buttons that appear available but fail in confusing ways. Observability for this module must include action eligibility reasoning, not just visual render milestones.

## Mechanism story

When the application refreshes session data, this module receives a collection of session records and a set of derived overlays from other modules (transcription preview snippets, error counts, snip coverage hints, retryability signals, and active-operation markers). The module first establishes a stable ordering policy for cards, then maps each session into a display model with explicit status classes and secondary messaging.

The display model should be deterministic from known inputs. If two identical input states can yield different card labels, that is a defect. Determinism matters because users form habits around list interpretation. A stable card language lets them decide quickly whether to open detail now, retry, or ignore.

After initial render, this module listens for progressive hydration updates. Each update should either enrich existing cards or prune stale overlays for sessions no longer present. The module should avoid churn that causes cards to flicker through contradictory states. Transition behavior should be monotonic where possible: unknown -> loading -> resolved, rather than unknown -> resolved -> loading again unless data truly invalidated.

Action wiring is then applied on top of the display model. Retry buttons, delete affordances, and open-detail handlers should consult eligibility state that is visible in instrumentation. “Action visible” and “action valid” should be tightly aligned.

## Signals to watch

For this module, the most useful telemetry is not low-level render internals but semantic checkpoints:

- list hydration start and list hydration done
- card model build count and status-distribution summary
- preview enrichment batch applied
- stale overlay prune pass
- action eligibility map calculated
- user action events: card opened, retry clicked, delete requested

The status-distribution summary is especially valuable. If the module suddenly reports an extreme spike of one status class (for example, nearly all sessions “loading preview” for too long), this often points to upstream degradation or a broken enrichment merge, not individual card bugs.

## Healthy sequence example

A healthy startup sequence usually looks like this narrative:

The list reports hydration start, then emits hydration done with session count. Card models are computed and rendered with initial statuses. Shortly after, one or more enrichment batches apply transcript-preview overlays, and a prune pass removes stale overlay entries. The status-distribution summary stabilizes. Users open a card or trigger retry actions, and action eligibility telemetry confirms those actions were valid at the time of interaction.

In this healthy case, short-lived “loading preview” states appear and then resolve. Cards do not oscillate between contradictory labels. Retry buttons appear only where retryability is true. Delete actions appear only for sessions in allowed states.

## Failure cues and likely causes

If many cards remain in a loading state beyond expected windows, look first at preview enrichment timing and upstream snip-read operations. If enrichment batches complete but cards remain stale, inspect merge logic and stale-cache pruning. If status distribution changes dramatically between refresh cycles without corresponding data change, inspect deterministic mapping rules and derived-state invalidation.

If users report clicking retry and receiving no effect, compare action-click events with action-eligibility snapshots captured at click time. If retry clicks occur when retryability is false, the UI gate is wrong. If retryability is true but downstream never receives a request, handler wiring is wrong.

If cards show optimistic labels while details reveal errors, the card model is masking true state. In that case, add or correct explicit status precedence rules. The list should never claim certainty that detail cannot support.

## What this module should make easy for humans

A human operator should be able to answer, quickly and without opening code: how many sessions are truly ready, how many are waiting on enrichment, how many have recoverable transcript gaps, and whether user-visible actions are being presented correctly. If those answers require deep log archaeology, visibility is still incomplete.

The module’s mission is trust at a glance. The factory-tour mission is trust with evidence. Both are required for this part to be considered healthy under the standard.
