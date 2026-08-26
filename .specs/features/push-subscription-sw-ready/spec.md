# Push Subscription Service-Worker-Ready Race Specification

## Problem Statement

`requestPushSubscription()` (`lib/notifications/client.ts`) calls `pushManager.subscribe()` immediately after `navigator.serviceWorker.register()` resolves, without waiting for the registration to become **active**. `register()` resolves as soon as the registration exists (installing state), not once it's active - but `subscribe()` requires an active worker at the moment it's called. Confirmed in production Sentry logs (this session's log analysis): a single real tester's session showed 5 successful `subscribed` outcomes interleaved with 3 `subscribe_failed` outcomes, all three carrying the identical browser exception `"Failed to execute 'subscribe' on 'PushManager': Subscription failed - no active Service Worker"` - a textbook intermittent race, not a deterministic failure. Users who lose this race never get a push subscription, so they silently stop receiving turn/heating notifications with no visible error.

## Goals

- [ ] Eliminate the race: `pushManager.subscribe()` is only ever called once the service worker registration is confirmed active.
- [ ] Fail fast and observably if activation doesn't happen in a bounded time, instead of hanging forever.
- [ ] Zero behavior change to every other outcome this function already produces (`unsupported`, `permission_denied`, `vapid_key_missing`, `subscribed`, `subscribe_failed`).

## Out of Scope

| Feature | Reason |
| --- | --- |
| Server-side delivery/dispatch changes | Ruled out this session - production logs show 2/2 real dispatch attempts delivered successfully. Not implicated in this bug. |
| Preview-environment `permission_denied` UX (e.g. detecting a prior denial and changing the button/copy) | Separate UX question spotted during log analysis, not a defect - browsers legitimately return `denied` without re-prompting once a user has denied. |
| Automatic retry after a failed/timed-out subscribe attempt | Every existing failure path in this function returns `null` once, with no built-in retry - this fix keeps that shape rather than introducing new retry semantics. |
| Changes to `sw/sw.ts` or its own Sentry instrumentation | Unaffected by this fix - the race is entirely on the page side, before the worker is even asked to do anything push-related. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Whether waiting for SW activation should be unbounded or timeout-guarded | Timeout-guarded | `navigator.serviceWorker.ready` is not guaranteed to ever settle if the registration becomes `redundant` before activating (a known browser-API gotcha) - an unbounded await risks trading today's fast, loud failure for a silent, permanent hang. | y (user chose this explicitly) |
| Timeout duration | 10 seconds | Generous margin over normal SW install/activate time (sub-second to a few seconds even for the current ~240KB bundle on a reasonable connection), while still failing within a bounded, user-perceptible window rather than hanging indefinitely. | n - reasonable default, adjustable if it proves too tight/loose in practice |
| Log reason/severity for the new timeout outcome | New reason `sw_not_ready`, logged at `error` (same severity class as `subscribe_failed`) | It's a distinct, actionable failure mode from `subscribe_failed` (we never even got to call `subscribe()`) - keeping it a separate reason string preserves the diagnostic precision that's the whole point of this logging system. | n - naming choice, open to bikeshedding |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Reliable push subscription regardless of service worker activation timing ⭐ MVP

**User Story**: As a visitor opting into push notifications (queue join flow or seat waitlist), I want my subscribe attempt to wait for the service worker to actually be active, so that I don't intermittently and silently fail to get notified due to a timing race that has nothing to do with my actual choice to opt in.

**Why P1**: This is the confirmed, sole root cause of the "notifications don't fire" reports that motivated this whole investigation. There is no smaller vertical slice - the fix is inherently one atomic behavior change.

**Acceptance Criteria**:

1. WHEN the user has granted notification permission and a VAPID key is configured THEN the system SHALL await the service worker registration reaching an active state (via `navigator.serviceWorker.ready`) before calling `pushManager.subscribe()`.
2. WHEN the service worker registration is already active at the time of the call (e.g. a returning visitor) THEN the system SHALL proceed to `subscribe()` without introducing any additional observable delay beyond `ready` resolving immediately.
3. IF the service worker registration does not become active within 10 seconds THEN the system SHALL abandon the attempt, log a `sw_not_ready` outcome at `error` severity, and return `null` - without ever calling `pushManager.subscribe()`.
4. IF `pushManager.subscribe()` still throws after the registration is confirmed active THEN the system SHALL continue to log `subscribe_failed` at `error` severity and return `null`, unchanged from current behavior.
5. The system SHALL preserve every other existing outcome (`unsupported`, `permission_denied`, `vapid_key_missing`, `subscribed`) with unchanged behavior, log reason, and log severity.

**Independent Test**: Stub a service worker registration whose `active` state flips from not-ready to ready after a short delay; confirm `subscribe()` is only invoked after that delay elapses. Separately, stub a registration that never becomes ready; confirm the function returns `null` at (approximately) the timeout boundary without ever calling `subscribe()`, and logs `sw_not_ready`.

---

## Edge Cases

- IF `navigator.serviceWorker.register()` itself rejects THEN the system SHALL continue to log `subscribe_failed` (existing catch-all, unaffected by this fix - the new wait-for-ready step only begins after `register()` has already resolved).
- WHEN the registration becomes active a few milliseconds before the 10-second timeout THEN the system SHALL still proceed to `subscribe()` normally (no off-by-one boundary failure).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| SWREADY-01 | P1 | Tasks (T1) | In Tasks |
| SWREADY-02 | P1 | Tasks (T1) | In Tasks |
| SWREADY-03 | P1 | Tasks (T1) | In Tasks |
| SWREADY-04 | P1 | Tasks (T1) | In Tasks |
| SWREADY-05 | P1 | Tasks (T1) | In Tasks |

**ID format:** `SWREADY-[NUMBER]`, mapped 1:1 to the acceptance criteria above in order.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 5 total, 5 mapped to tasks (all to T1), 0 unmapped

---

## Success Criteria

- [ ] Unit tests demonstrate `subscribe()` is never called before the stubbed registration reports active.
- [ ] Unit tests demonstrate the timeout path returns `null`, logs `sw_not_ready`/`error`, and never calls `subscribe()`.
- [ ] All 4 existing `requestPushSubscription` tests continue to pass with unchanged assertions (behavior-preserving for every non-race path).
- [ ] Full existing gate (unit + integration + typecheck + lint + build) stays green.
