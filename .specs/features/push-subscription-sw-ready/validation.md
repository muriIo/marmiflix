# push-subscription-sw-ready Validation

**Date**: 2026-08-26
**Spec**: `.specs/features/push-subscription-sw-ready/spec.md`
**Diff range**: `development..HEAD` (commits `3f75cc8` docs, `62e98bb` fix, `a51119c` test - fix-round-1 coverage gaps)
**Verifier**: independent sub-agent (author ≠ verifier), re-verification iteration 2 of max 3

---

## Validation: push-subscription-sw-ready - PASS ✅

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1   | ✅ Done | All "Done when" items re-checked independently against `lib/notifications/client.ts` and `lib/notifications/__tests__/client.test.ts`. The "Verifier fix round 1" note's four claimed additions are all present and verified below. |

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SWREADY-01: WHEN permission granted + VAPID configured THEN await active registration before `subscribe()` | `subscribe()` must not be called until `navigator.serviceWorker.ready` resolves | `lib/notifications/__tests__/client.test.ts:180-219` - `await vi.advanceTimersByTimeAsync(0); expect(subscribe).not.toHaveBeenCalled();` then after `resolveReady(...)`, `expect(subscribe).toHaveBeenCalledTimes(1)` | ✅ PASS |
| SWREADY-02: WHEN registration already active THEN proceed to `subscribe()` without additional observable delay | subscribe proceeds "without introducing any additional observable delay beyond `ready` resolving immediately" | `lib/notifications/__tests__/client.test.ts:97-111` - granted/success test, `ready` defaults to an already-resolved registration (`client.test.ts:40`), real timers, no artificial wait needed for `result` to resolve | ⚠️ Spec-precision gap (unchanged from iteration 1) - functionally proven (no hang, no fake-timer advance required), but no test explicitly instruments elapsed time/tick-count on the already-active path the way SWREADY-01/03 do with `vi.useFakeTimers()`. Non-blocking: this is an inherent difficulty of asserting "zero added delay" in JS, not a coverage regression, and iteration 1's fix round correctly judged no separate test could close it further without diminishing returns. |
| SWREADY-03: IF registration never becomes active within 10s THEN abandon, log `sw_not_ready`/error, return `null`, never call `subscribe()` | exact reason string `sw_not_ready`, `error` severity, `null` return, `subscribe` uncalled | `lib/notifications/__tests__/client.test.ts:241-268` - `await vi.advanceTimersByTimeAsync(10_000); expect(result).toBeNull(); expect(subscribe).not.toHaveBeenCalled(); expect(loggerErrorSpy).toHaveBeenCalledWith("push_subscription_outcome", expect.objectContaining({ reason: "sw_not_ready" }))` | ✅ PASS |
| SWREADY-04: IF `subscribe()` still throws once active THEN continue to log `subscribe_failed`/error, return `null`, unchanged | exact reason string `subscribe_failed`, `error` severity, `null` return | `lib/notifications/__tests__/client.test.ts:221-239` - `expect(result).toBeNull(); expect(subscribe).toHaveBeenCalledTimes(1); expect(loggerErrorSpy).toHaveBeenCalledWith("push_subscription_outcome", expect.objectContaining({ reason: "subscribe_failed", detail: subscribeError.message }))` | ✅ PASS |
| SWREADY-05: preserve every other existing outcome (`unsupported`, `permission_denied`, `vapid_key_missing`, `subscribed`) unchanged in behavior, log reason, and log severity | return value AND log reason/severity both unchanged for all 4 outcomes | Return value + severity, per outcome: `client.test.ts:75-84` - `loggerInfoSpy` (asserts `info` level specifically) called with `reason: "unsupported"`; `:86-95` - `loggerInfoSpy` with `reason: "permission_denied"`; `:97-111` - `loggerInfoSpy` with `reason: "subscribed"`; `:113-123` - `loggerWarnSpy` (asserts `warn` level specifically) with `reason: "vapid_key_missing"`. Spying on the *specific* level method (`Sentry.logger.info` vs `.warn`) and asserting it was called with the matching reason proves both reason AND severity - if the code logged at the wrong level, the spied method would show 0 calls (confirmed empirically by the sensor's mutation 3 below). | ✅ PASS (gap from iteration 1 closed) |

**Status**: ✅ All ACs covered (4/5 clean PASS, 1 pre-existing spec-precision gap on SWREADY-02, unchanged from iteration 1 and judged non-blocking both times)

---

## Discrimination Sensor

Targeted the fix-round-1 additions specifically (different code paths than iteration 1's sensor, which targeted the core wait-for-ready gate) - the question this re-verification needed to answer independently was whether the *new* tests added to close iteration 1's gaps actually discriminate, not just exist.

| Mutation | File:line | Description | Killed? |
| --- | --- | --- | --- |
| 1 | `lib/notifications/client.ts:58-63` (scratch) | Changed the timeout timer's delay from `timeoutMs` to `timeoutMs - 1` (introduces an off-by-one in the near-boundary path) | ✅ Killed - "still calls subscribe() when the registration becomes active just before the 10s timeout" test failed (`expected "spy" to be called 1 times, but got 0 times`) |
| 2 | `lib/notifications/client.ts:102` (scratch) | Changed `await navigator.serviceWorker.register("/sw.js");` to swallow rejection: `.catch(() => undefined)` | ✅ Killed - "returns null and logs subscribe_failed if register() itself rejects" test failed (`expected { endpoint: ... } to be null`) |
| 3 | `lib/notifications/client.ts:30` (scratch) | Changed `OUTCOME_LOG_LEVEL.unsupported` from `"info"` to `"warn"` | ✅ Killed - "returns null ... logging reason=unsupported at info" test failed (`expected "info" to be called with arguments: [...] Number of calls: 0`) |

**Sensor depth**: lightweight (standard-risk feature, 3 mutations)
**Sensor outcome**: 3/3 killed - all mutations killed, no survivors. The fix-round-1 test additions (near-boundary test, register()-rejection test, legacy-outcome logger-level spies) are genuinely discriminating, not just present.

**Isolation**: `git worktree add <scratch> HEAD` (`node_modules` symlinked, never copied into scratch or written into the real tree). Baseline `git status --porcelain` on the real tree captured before sensor work (only the untracked `validation.md` this Verifier itself is about to write); confirmed identical after `git worktree remove --force` cleanup. No `git stash` used at any point.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ - fix-round-1 diff is test-only (one new `import * as Sentry`, one `StubRegistration` type extraction, one `registerError` stub option, 2 new tests, 4 augmented assertions on pre-existing tests) |
| Surgical changes | ✅ - only `lib/notifications/client.ts` and `lib/notifications/__tests__/client.test.ts` touched (plus feature's own `.specs/` docs) |
| No scope creep | ✅ - no unrelated refactors; `stubServiceWorkerSupport` extended with `registerError`, not replaced |
| Matches patterns | ✅ - reuses existing `logSubscriptionOutcome`/`OUTCOME_LOG_LEVEL`/`Sentry.logger` spy pattern already established in the file |
| Spec-anchored outcome check (asserted values match spec) | ✅ - 4/5 clean PASS, 1 pre-existing non-blocking spec-precision gap (SWREADY-02) |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ✅ - all 5 ACs and both spec.md Edge Cases now have direct `file:line` evidence |
| Every test maps to a spec requirement - no unclaimed tests | ✅ - all 9 tests in the describe block map to a specific AC or Edge Case (see table above and Edge Cases below); no stray/unclaimed tests |
| Documented guidelines followed: [file(s) or "none - strong defaults applied"] | ✅ - `coding-principles.md` followed; no project-specific test-coverage doc exists (confirmed in tasks.md's own Test Coverage Matrix note) |

No unrelated code was "improved." No dead code removed beyond what earlier diffs already orphaned.

---

## Edge Cases

- [x] `navigator.serviceWorker.register()` itself rejects → `subscribe_failed` (existing catch-all): **now tested** - `client.test.ts:125-140`, `registerError` option added to `stubServiceWorkerSupport`, asserts `result` is `null` and `Sentry.logger.error` called with `reason: "subscribe_failed"` and the rejection's message as `detail`.
- [x] Registration becomes active a few ms before the 10s timeout (no off-by-one) → **now tested** - `client.test.ts:142-178`, advances fake timers to 9,999ms, resolves `ready`, advances 1 more ms, asserts `subscribe` was called exactly once and the correct result returned. Confirmed to actually discriminate via sensor mutation 1 above.

---

## Gate Check

- **Gate command**: `npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build`
- **Result**: all green - lint clean, typecheck clean, 154 unit tests passed (0 failed), 70 integration tests passed (0 failed), production build succeeded (including the `build:sw` prebuild step)
- **Test count before feature**: 149 unit
- **Test count after original fix (iteration 1)**: 152 unit (+3)
- **Test count after fix-round-1**: 154 unit (+2 more), 70 integration (unchanged - no integration-layer surface per this feature's Test Coverage Matrix)
- **Delta**: +5 new unit tests total across both rounds
- **Skipped tests**: none
- **Failures**: none

---

## Fix Plans

None. No gaps requiring code or test changes remain. SWREADY-02's residual spec-precision gap is a labeling/rigor note carried forward from iteration 1, not a defect - it does not block PASS.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| SWREADY-01 | Implementing | ✅ Verified |
| SWREADY-02 | Implementing | ✅ Verified |
| SWREADY-03 | Implementing | ✅ Verified |
| SWREADY-04 | Implementing | ✅ Verified |
| SWREADY-05 | Implementing | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 4/5 ACs cleanly matched spec outcome (SWREADY-01, 03, 04, 05); 1 non-blocking spec-precision gap (SWREADY-02 - "no added delay" proven functionally but not instrumented with fake-timer precision), unchanged and accepted from iteration 1
**Sensor**: 3/3 mutations killed - targeted the fix-round-1 additions specifically (near-boundary timer, register()-rejection catch, legacy-outcome severity mapping) and confirmed they genuinely discriminate, not just exist
**Gate**: 5/5 gate commands passed (lint, typecheck, 154 unit, 70 integration, build), 0 failed

**What works**: All 3 of iteration 1's hard gaps are closed with real, discriminating test evidence: the 4 legacy-outcome tests now assert `Sentry.logger` reason AND severity (via level-specific spies), both spec.md Edge Cases (register() rejection, near-10s-boundary) have dedicated tests, and the sensor confirms each addition actually catches its corresponding regression. The core fix (wait-for-ready gate, timeout/severity, registration-source decision) remains correct and covered, as it was on iteration 1.

**Issues found**: None blocking. SWREADY-02's spec-precision framing is carried forward as a documented, accepted non-blocking gap - asserting "zero added delay" with more rigor than the existing tests provide would require timer instrumentation disproportionate to the risk (the mechanism itself - a `Promise.race`-style helper with no artificial timer on the already-active path - has no code path that could introduce a delay independent of what SWREADY-01/03's tests already exercise).

**Next steps**: None required. Feature is verified; `spec.md` traceability updated to `Verified` for all 5 requirements.
