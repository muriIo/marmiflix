# Push Subscription Service-Worker-Ready Race Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/push-subscription-sw-ready/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase sampling - no `AGENTS.md`/`CONTRIBUTING.md`/coverage-threshold config found in this repo, so the strong default applies (domain logic: all branches, 1:1 to spec ACs, every listed edge case). Existing test `lib/notifications/__tests__/client.test.ts` (jsdom, vitest) used as the floor for style/location/framework.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Browser-side notification client logic (`lib/notifications/client.ts`) | unit | All branches; 1:1 to SWREADY-01..05; both new edge cases (ready-before-timeout, timeout-with-no-ready) covered | `lib/notifications/__tests__/*.test.ts` | `npm run test:unit` |

No API route, component, or server-side layer is touched by this feature (confirmed during Specify: both call sites, `Landing.tsx`/`QueueFull.tsx`, are unaffected) - no integration/e2e layer in scope.

## Gate Check Commands

> Generated from `package.json` scripts - confirmed present and already used earlier this session.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After the task (unit tests only - the only layer in scope) | `npm run test:unit` |
| Build | End of phase / before commit | `npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build` |

(Full/integration gate is listed for completeness per the template but not exercised - this feature has no integration-tested layer.)

---

## Execution Plan

One phase, one task - the fix is a single cohesive change to one function plus its co-located tests (see rationale below the task breakdown).

### Phase 1: Fix the race

```
T1
```

---

## Task Breakdown

### T1: Wait for an active service worker before calling `pushManager.subscribe()`

**What**: In `requestPushSubscription()`, wait for the service worker registration to become active (bounded by a 10s timeout) before calling `subscribe()`; add the new `sw_not_ready` log outcome; update its test double and add tests proving the race is fixed. One cohesive change - the helper has no meaning or test surface independent of its single call site (see design's "module-private" note), so splitting implementation from its tests here would only produce an intermediate, unverifiable state.

**Where**: `lib/notifications/client.ts` (modify), `lib/notifications/__tests__/client.test.ts` (modify)

**Depends on**: None

**Reuses**: Existing `logSubscriptionOutcome`/`OUTCOME_LOG_LEVEL` (add one key, mechanism unchanged), existing outer `try/catch` in `requestPushSubscription` (unchanged), existing `stubServiceWorkerSupport` test helper (extended, not replaced)

**Requirement**: SWREADY-01, SWREADY-02, SWREADY-03, SWREADY-04, SWREADY-05

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven` (this skill, for the Execute cycle itself)

**Done when**:

- [ ] `SW_READY_TIMEOUT_MS = 10_000` constant and `waitForActiveServiceWorker(timeoutMs): Promise<ServiceWorkerRegistration | null>` helper added to `lib/notifications/client.ts`, per design's sketch (races `navigator.serviceWorker.ready` vs. a timer, clears the timer on whichever settles first, never rejects)
- [ ] `requestPushSubscription()` calls `waitForActiveServiceWorker(SW_READY_TIMEOUT_MS)` after permission is granted and before calling `subscribe()`
- [ ] On timeout (`null` returned by the helper): logs `sw_not_ready` via the existing `logSubscriptionOutcome` mechanism, returns `null`, and never calls `pushManager.subscribe()` (SWREADY-03)
- [ ] `pushManager.subscribe()` is called on the registration the helper resolved (from `navigator.serviceWorker.ready`), not the possibly-still-installing one `register()` returned (design decision - same object in this app, but sourced correctly)
- [ ] `OUTCOME_LOG_LEVEL` gains `sw_not_ready: "error"`
- [ ] `stubServiceWorkerSupport` in `client.test.ts` extended so callers can control when/whether `navigator.serviceWorker.ready` resolves (e.g. accept an optional `ready` promise, defaulting to an already-active registration so the existing non-timing tests need no changes)
- [ ] New test (SWREADY-01/02, spec's first Independent Test): with `vi.useFakeTimers()`, a `ready` promise that resolves after a delay shorter than 10s - asserts `subscribe()` has not been called before the delay elapses and has been called after
- [ ] New test (SWREADY-03, spec's second Independent Test): with `vi.useFakeTimers()`, a `ready` promise that never resolves, advanced past 10s - asserts the function resolves to `null`, `subscribe()` is never called, and the `sw_not_ready`/`error` outcome was logged (spy on `Sentry.logger.error`, e.g. `vi.spyOn(Sentry, "logger")`-shaped access consistent with how `@sentry/nextjs` exposes `logger`)
- [ ] All 4 pre-existing tests in `client.test.ts` still pass with unchanged assertions (SWREADY-05 regression guard)
- [ ] Gate check passes: `npm run test:unit` - **6 tests pass** in the `requestPushSubscription` describe block (4 existing + 2 new), no silent deletions
- [ ] Full build gate passes: `npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build`

**Tests**: unit
**Gate**: quick (per-task), build (end of phase - same task here, since it's the only one)

**Commit**: `fix(notifications): wait for service worker to be active before subscribing`

---

## Phase Execution Map

```
Phase 1: T1
```

Single task, single phase - executed inline, no sub-agent batching needed (well under the ~7-task budget).

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Wait for active SW before subscribing | 1 function's control flow + its co-located unit tests (2 files: source + test) | ✅ Granular - "source + its test" is the standard co-location pairing, not a multi-component split |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | (no arrows - single node) | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1: Wait for active SW before subscribing | Browser-side notification client logic (`lib/notifications/client.ts`) | unit | unit | ✅ OK |

**Note on task count**: this feature resolves to exactly one atomic task - at or below the skill's own "≤3 obvious steps → tasks are implicit" threshold. It's written up formally here because it was explicitly requested, not because the scope warranted splitting; padding it into artificial sub-tasks would have violated the co-located-tests rule (the helper has no independently-testable meaning apart from its one call site).
