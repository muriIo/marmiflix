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

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
