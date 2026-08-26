# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Assert numeric spec bounds like a real-time convergence window directly in a test, or explicitly document in the Test Coverage Matrix why the bound is only satisfied by construction and not directly measured.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `realtime-sync` · harmful: 0
- features: lunchbox-queue
- evidence: QUEUE-18 / validation.md#Spec-Anchored Acceptance Criteria (realtime-sync)
- last seen: 2026-08-18T20:04:54Z

### L-002 - When a task's Done-when list enumerates a fixed set of error classes but a later task needs a case none of them fit, add the minimal new error class and mark it SPEC_DEVIATION instead of overloading an existing error type semantically.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `domain-errors` · harmful: 0
- features: lunchbox-queue
- evidence: lib/queue/types.ts:76 (domain-errors)
- last seen: 2026-08-18T20:04:54Z

### L-003 - When one module produces a payload another module discriminates on, assert the discriminating field's presence and value in the producer's test, not just the fields it happens to render
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `notifications` · harmful: 0
- features: queue-notifications
- evidence: NOTIF-23; lib/notifications/dispatcher.ts:57 vs components/queue/QueueFull.tsx:40 (notifications)
- last seen: 2026-08-21T18:26:08Z

### L-004 - Every acceptance criterion ID listed on a task must be covered by that task's Done-when criteria, not merely name-dropped in its Requirement line
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `tasks` · harmful: 0
- features: queue-notifications
- evidence: NOTIF-25; app/api/queue/join/route.ts:67; tasks.md T23 Requirement line (tasks)
- last seen: 2026-08-21T18:26:08Z

### L-005 - For a criterion phrased as a state transition, test both that it fires on the transition and that it does not fire when the precondition holds but the transition does not occur
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `queue` · harmful: 0
- features: queue-notifications
- evidence: Sensor mutation 3; lib/queue/store.ts:107 (queue)
- last seen: 2026-08-21T18:26:08Z

### L-006 - A cleanup or side-effect callback introduced as an optional parameter needs a task that wires it at every call site, or it ships as dead code
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `notifications` · harmful: 0
- features: queue-notifications
- evidence: spec.md Edge Case 410/404; lib/notifications/dispatcher.ts:89; app/api/queue/route.ts:20 (notifications)
- last seen: 2026-08-21T18:26:08Z

### L-007 - When a spec AC requires no additional observable delay, assert it with a fake-timer test proving zero timer advancement was needed, not just a functional correctness test on the happy path.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `notifications` · harmful: 0
- features: push-subscription-sw-ready
- evidence: SWREADY-02 (spec.md) (notifications)
- last seen: 2026-08-26T20:06:15Z

### L-008 - When an AC requires preserving a side effect such as a log reason or severity across existing code paths, assert that side effect directly in each affected test, not only the function's return value.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `notifications` · harmful: 0
- features: push-subscription-sw-ready
- evidence: SWREADY-05 (spec.md); validation.md iteration 1 (notifications)
- last seen: 2026-08-26T20:06:15Z

### L-009 - Every edge case listed in a spec's Edge Cases section must get its own explicit Done-when test item in tasks.md, not be left implicit in the main acceptance-criteria test plan.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `tasks-authoring` · harmful: 0
- features: push-subscription-sw-ready
- evidence: spec.md Edge Cases section; validation.md iteration 1 (tasks-authoring)
- last seen: 2026-08-26T20:06:15Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
