# Lunchbox Heating Queue Validation

**Date**: 2026-08-18
**Spec**: `.specs/features/lunchbox-queue/spec.md`
**Diff range**: `18592fe..HEAD` (HEAD = `86ceb54`)
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1-T7 (Foundation) | ✅ Done | Commits `a3f05ae`..`a326fd9`; build gate green at T7 |
| T8-T14 (Domain Types & Engine) | ✅ Done | Commits `021e534`..`0e2ac27`; 43/43 unit at T14 |
| T15-T17 (Redis Store & Atomicity) | ✅ Done | Commits `910d1fc`..`bd37278`; full gate green |
| T18-T23 (API Routes) | ✅ Done | Commits `9ac4262`..`13f956e`; 35/35 integration at T23 |
| T24-T27 (Client Identity & Polling Hook) | ✅ Done | Commits `b9911de`..`c57f1d3` |
| T28-T34 (UI Screens) | ✅ Done | Commits `d907939`..`d924adc`; build gate only (no automated tier, per Test Coverage Matrix) |
| T35 (Deployment Runbook) | ✅ Done | Commit `86ceb54`; `DEPLOYMENT.md` covers Vercel project, Upstash Marketplace integration, custom domain, env vars |

35/35 tasks committed, one Conventional Commit per task (verified via `git log --oneline 18592fe..HEAD`: 38 total commits = 35 task commits + `b1b48d8` task-breakdown doc + `855f31e` .gitignore + `8f31d93` session-handoff doc, none of which are task commits).

No blocked or partial tasks found.

---

## Spec-Anchored Acceptance Criteria

### P1: See Queue Status and Join ⭐ MVP

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| 1. Visitor opens site → sees queue count + estimated wait | `queueCount` (int) + `estimatedWaitMs` = active remaining + 5min/waiting person | `lib/queue/__tests__/view.test.ts:54-57` - `expect(view.queueCount).toBe(3); expect(view.estimatedWaitMs).toBe(120_000 + 2 * FIVE_MIN_MS)` | ✅ PASS |
| 2. Join when queue+active both empty → confirm-turn, skip waiting | `self.phase === 'confirming'` | `app/api/queue/__tests__/join.integration.test.ts:29` - `expect(body.view.self.phase).toBe("confirming")` | ✅ PASS |
| 3. Join when occupied → appended to waiting, waiting screen | `self.phase === 'waiting'`, correct `position` | `app/api/queue/__tests__/join.integration.test.ts:38-39` - `expect(body.view.self.phase).toBe("waiting"); expect(body.view.self.position).toBe(1)` | ✅ PASS |
| 4. Non-empty name required | 400 on empty/whitespace name | `lib/queue/__tests__/engine.test.ts:244-254` (`ValidationError`) + `app/api/queue/__tests__/join.integration.test.ts:51-57` - `expect(response.status).toBe(400)` | ✅ PASS |
| 5. All copy in pt-BR | Every user-facing string is Portuguese; `<html lang="pt-BR">` | `app/layout.tsx:29` - `<html lang="pt-BR" ...>`; `components/queue/Landing.tsx:38-86`, `Waiting.tsx`, `ConfirmTurn.tsx`, `Heating.tsx`, `ErrorScreen.tsx` (all strings inspected, all pt-BR) | ✅ PASS (code-level; no automated tier per Test Coverage Matrix) |

### P1: Wait My Turn ⭐ MVP

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| 1. Live position + ETA = active remaining + 5min × people ahead | exact formula | `lib/queue/__tests__/view.test.ts:91-100` - `expect(view.self?.estimatedWaitMs).toBe(60_000 + FIVE_MIN_MS)` (1 person ahead) | ✅ PASS |
| 2. "Leave Queue" removes and returns to landing | 200, entry gone | `app/api/queue/__tests__/leave.integration.test.ts:40-45` - `expect(response.status).toBe(200); expect(body.ok).toBe(true)`; `components/queue/Waiting.tsx:57` calls `queue.actions.leave()` | ✅ PASS |
| 3. Place preserved across reload via stored session | reload resumes correct screen | Composed across: `lib/__tests__/identity.test.ts:14-17` (round-trip persistence) + `hooks/__tests__/useQueue.test.ts:77-88` (poll includes stored `id` as query param) + `app/api/queue/__tests__/queue-get.integration.test.ts:44-58` (GET with `id` returns correct `self.phase`/`position`) | ✅ PASS (no single end-to-end test; verified via 3 composed unit/integration tests - acceptable given the project's explicit no-e2e scope) |

### P1: Confirm and Take My Turn ⭐ MVP

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| 1. Reaching front → confirm-turn + vibration + animation | `navigator.vibrate` called, confetti/animation triggered | `components/queue/ConfirmTurn.tsx:16-22` - `if (typeof navigator.vibrate === "function") navigator.vibrate(200); confetti(...); playTurnChime();` (on mount effect) | ✅ PASS (code-level; no automated tier) |
| 2. 20s countdown + "I'm Here" button while confirming | visible countdown, button present | `components/queue/ConfirmTurn.tsx:46,66-73` - `secondsLeft` derived from `deadline - queue.now()`; button calls `confirmTurn()` | ✅ PASS (code-level) |
| 3. Tap "I'm Here" within window → start heating | `active.phase` transitions `confirming → heating`, deadline = now+5:15 | `lib/queue/__tests__/engine.test.ts:337-351` - `expect(result.active).toEqual({..., phase: "heating", deadline: now + HEATING_WINDOW_MS})`; `app/api/queue/__tests__/confirm-turn.integration.test.ts:33-43` | ✅ PASS |
| 4. 20s elapses untapped → removed entirely, return to landing, next promoted | entry dropped, next `waiting` head → `active` in `confirming` with fresh 20s deadline | `lib/queue/__tests__/engine.test.ts:44-76` (QUEUE-11) - exact `result.active` equality with fresh deadline, old id confirmed absent; `app/api/queue/__tests__/queue-get.integration.test.ts:71-92` (reap-on-read) | ✅ PASS |
| 5. Vibration API guarded by feature detection | no throw when unsupported | `components/queue/ConfirmTurn.tsx:17` - `typeof navigator.vibrate === "function"` guard | ✅ PASS (code-level) |

### P1: Heat My Lunchbox ⭐ MVP

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| 1. Heating start → timer from 0:00 + "I'm Done" button | timer starts at 0, button present throughout | `components/queue/Heating.tsx:22,58,67-74` - `elapsedMs` derived from reconstructed `phaseStartedAt`; button always rendered, not conditionally hidden | ✅ PASS (code-level) |
| 2. "I'm Done" any time 0:00-5:15 → immediate end + advance next | `active` cleared, next `waiting` head promoted to `confirming` | `lib/queue/__tests__/engine.test.ts:399-413` (QUEUE-14) + `app/api/queue/__tests__/finish.integration.test.ts:34-46` - `expect(state.active?.id).toBe(bruno.id); expect(state.active?.phase).toBe("confirming")` | ✅ PASS |
| 3. 5:15 elapses untouched → auto-end + advance next | same promotion, via reap | `lib/queue/__tests__/engine.test.ts:78-103` (QUEUE-15) - exact `result.active` equality with fresh confirming deadline | ✅ PASS |
| 4. 5:00-5:15 visually flags urgency | urgency indicator shown in that window only | `components/queue/Heating.tsx:7,24,40-43,53-56,61-65` - `URGENCY_WINDOW_MS = 15_000; isUrgent = remainingMs <= URGENCY_WINDOW_MS` (true exactly for elapsed ∈ [5:00, 5:15]); color change + pulse class + warning text | ✅ PASS (code-level) |
| 5. Turn ends and queue empty → returns to empty state | `active === null`, `waiting === []` | `lib/queue/__tests__/engine.test.ts:415-423` (QUEUE-17) + `app/api/queue/__tests__/finish.integration.test.ts:48-58` - `expect(state.active).toBeNull(); expect(state.waiting).toHaveLength(0)` | ✅ PASS |

### P1: Stay in Sync ⭐ MVP

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| 1. Any state change reflected on all clients within 3s | convergence bound ≤ 3000ms | Not directly measured end-to-end (no e2e tier). Architecturally satisfied: `hooks/__tests__/useQueue.test.ts:57-75` proves poll cadence is exactly 2000ms (< 3s bound); `app/api/queue/route.ts:9-14` always reaps via `withQueueMutation` before building the view, so every poll reflects the latest state including timeouts | ⚠️ Spec-precision gap - no test asserts the literal "3 seconds" bound; the 2s poll interval satisfies it by construction but this is architectural reasoning, not a directly measured assertion (project explicitly scoped out e2e/multi-client tests) |
| 2. FIFO ordering enforced; no double-assignment under simultaneous joins | exactly one of two concurrent joins becomes `active`, other lands in `waiting` at position 1 | `lib/queue/__tests__/with-queue-mutation.integration.test.ts:12-43` (QUEUE-19) - `expect(finalState.active).not.toBeNull(); expect(finalState.waiting).toHaveLength(1); expect(finalState.waiting[0].id).not.toBe(finalState.active!.id)` | ✅ PASS |

### P2: Prevent Duplicate Active Entries

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| 1. Same name (case-insensitive, trimmed) already active → reject + message | `DuplicateNameError` → 409, error message present | `lib/queue/__tests__/engine.test.ts:207-229` (exact/case/whitespace variants, `.each`) + `app/api/queue/__tests__/join.integration.test.ts:42-49` - `expect(response.status).toBe(409); expect(body.error).toBeTruthy()` | ✅ PASS |

### P2: See Who's Ahead

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| 1. Waiting visitor sees names ahead, in order | `namesAhead: string[]` display names only, join order | `lib/queue/__tests__/view.test.ts:102-108` (QUEUE-21) - `expect(view.namesAhead).toEqual(["Bruno", "Carla"])`; `app/api/queue/__tests__/queue-get.integration.test.ts:44-58` - `expect(body.namesAhead).toEqual(["Bruno"])` | ✅ PASS |

### P3: Audible Cue

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| 1. Foreground + not muted → short sound on entering confirm-turn, alongside vibration/animation | sound plays only when tab foregrounded; best-effort no-op otherwise | `lib/sound.ts:1-4` - `if (typeof document !== "undefined" && document.hidden) return;` before playing; `components/queue/ConfirmTurn.tsx:21` - `playTurnChime()` called in the same mount effect as vibration/confetti | ✅ PASS (code-level; no automated tier - "not muted" is inherently unverifiable by an automated test since browsers block programmatic mute detection, so the implementation reasonably interprets it as "foreground tab, best-effort autoplay") |

**Status**: ⚠️ Spec-precision gap flagged (1) - all other ACs covered and matched to spec-defined outcomes. No failing ACs.

---

## Edge Cases

- [x] Vibration API unsupported → confirm-turn screen still shows (guarded by `typeof navigator.vibrate === "function"`, `components/queue/ConfirmTurn.tsx:17`)
- [x] Tab closed while merely waiting → entry stays in `waiting[]` until `Leave Queue` or promotion+20s-timeout removes it (no heartbeat mechanism exists anywhere in `engine.ts`/`store.ts` - confirmed by reading full `applyLeave`/`reapExpired`)
- [x] Tab closed during active-heating and never returns → auto-ends at 5:15 via the same `reapExpired` path as any other timeout, no special-casing (`lib/queue/engine.ts:45-51`)
- [x] Empty queue + no active → landing shows "no wait, join now" rather than a stale/zero estimate (`components/queue/Landing.tsx:42,54-63` - conditional headline text, estimated-wait paragraph only rendered when `!isEmpty`)

---

## Discrimination Sensor

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ------------ | ------- |
| 1 | `lib/queue/engine.ts:70` | Flipped `applyJoin`'s empty-queue fast-path condition: `if (!state.active && state.waiting.length === 0)` → `if (state.active && state.waiting.length === 0)` (QUEUE-02/03 boundary) | ✅ Killed - 2 tests failed in `engine.test.ts` |
| 2 | `lib/queue/store.ts:37` | Inverted CAS win condition: `return result === 1` → `return result === 0` (atomicity guarantee, QUEUE-19) | ✅ Killed - 4 tests failed across `store.integration.test.ts` and `with-queue-mutation.integration.test.ts` |
| 3 | `lib/queue/route-helpers.ts:33` | Inverted token-verification gate: `if (!verifyToken(...))` → `if (verifyToken(...))` (auth/ownership check shared by leave/confirm-turn/finish routes) | ✅ Killed - 11 tests failed across `leave.integration.test.ts`, `confirm-turn.integration.test.ts`, `finish.integration.test.ts` |

**Sensor depth**: lightweight (3 mutations, standard-risk feature - no payment/auth-as-a-service, internal office tool)
**Result**: 3/3 killed - PASS ✅

**Isolation**: mutations run in a temporary `git worktree` at a scratch path (never `git stash`), node_modules symlinked in, `.env.test`/`.env.local` copied in, tests run against the same Dockerized Redis/SRH stack. Real worktree's `git status --porcelain` recorded before sensor work (` M .claude/skills/tlc-spec-driven/scripts/check_commit.py` - a pre-existing, feature-unrelated file-mode diff) and confirmed identical after `git worktree remove --force`.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ - each file does one job; `route-helpers.ts`'s `authorizeEntry` is genuine 3-route shared logic, not premature abstraction |
| Surgical changes | ✅ - no unrelated files touched outside the feature's own surface |
| No scope creep | ✅ - `ValidationError` (T8), lazy Redis client Proxy (T19), `route-helpers.ts` (T20) are all logged `SPEC_DEVIATION`s with concrete justification, not silent additions |
| Matches patterns | ✅ - consistent route-handler shape across all 5 API routes; consistent domain-error → status-code mapping |
| Spec-anchored outcome check (asserted values match spec) | ✅ - see table above; every P1/P2/P3 AC traced to an exact assertion, 1 spec-precision gap flagged (3s convergence bound, architectural not measured) |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ✅ - `engine.ts`/`view.ts` have 1:1 branch coverage incl. immutability tests; every route has happy path + every documented error code (400/403/404/409/429 as applicable) |
| Every test maps to a spec requirement - no unclaimed tests | ✅ - spot-checked all 6 unit test files and all 5 integration route test files; every `it()` cites or clearly maps to a QUEUE-* id or a named edge case |
| Documented guidelines followed | ✅ Test Coverage Matrix in `tasks.md` (Unit+Integration only, Vitest, no e2e - user's explicit choice) followed exactly; UI layer correctly left untested per that same matrix |

No "No" answers - quality gate passes.

---

## Gate Check

- **Gate command**: `npm run lint && npm run typecheck && npm run build && docker compose -f docker-compose.test.yml up -d && npm run test:unit && npm run test:integration`
- **Result**: lint clean, typecheck clean, build succeeded (5 API routes + `/` all compiled), 75 unit passed / 0 failed, 35 integration passed / 0 failed, 0 skipped
- **Test count before feature**: 0 (fresh project, `18592fe` predates any app code)
- **Test count after feature**: 110 (75 unit + 35 integration)
- **Delta**: +110 new tests
- **Skipped tests**: none
- **Failures**: none

---

## Fix Plans

None required - no failing ACs, no surviving mutants. The one spec-precision gap (3s convergence bound) does not warrant a fix task: it is inherent to the project's explicit no-e2e-tier scope decision (recorded in the Test Coverage Matrix and confirmed by the user during Tasks), and the 2s poll interval satisfies the bound by construction with a direct cadence test backing it.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| QUEUE-01 | Pending | ✅ Verified |
| QUEUE-02 | Pending | ✅ Verified |
| QUEUE-03 | Pending | ✅ Verified |
| QUEUE-04 | Pending | ✅ Verified |
| QUEUE-05 | Pending | ✅ Verified |
| QUEUE-06 | Pending | ✅ Verified |
| QUEUE-07 | Pending | ✅ Verified |
| QUEUE-08 | Pending | ✅ Verified |
| QUEUE-09 | Pending | ✅ Verified |
| QUEUE-10 | Pending | ✅ Verified |
| QUEUE-11 | Pending | ✅ Verified |
| QUEUE-12 | Pending | ✅ Verified |
| QUEUE-13 | Pending | ✅ Verified |
| QUEUE-14 | Pending | ✅ Verified |
| QUEUE-15 | Pending | ✅ Verified |
| QUEUE-16 | Pending | ✅ Verified |
| QUEUE-17 | Pending | ✅ Verified |
| QUEUE-18 | Pending | ⚠️ Verified (spec-precision gap - see above) |
| QUEUE-19 | Pending | ✅ Verified |
| QUEUE-20 | Pending | ✅ Verified |
| QUEUE-21 | Pending | ✅ Verified |
| QUEUE-22 | Pending | ✅ Verified |
| QUEUE-23 | Pending | ✅ Verified |

(Verifier does not edit `spec.md` directly per the read-only mandate over the real tree's authored documents; this table is the record for the orchestrator to apply.)

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 22/23 ACs matched spec-defined outcome precisely; 1 spec-precision gap flagged (QUEUE-18, 3s convergence bound - architectural, not directly measured, acceptable given the project's explicit no-e2e scope)
**Sensor**: 3/3 mutations killed
**Gate**: 110 passed (75 unit + 35 integration), 0 failed, 0 skipped; lint/typecheck/build all clean

**What works**: The full queue lifecycle (join → wait → confirm-turn → heating → finish), duplicate-name prevention, names-ahead display, FIFO/no-double-assignment under concurrent writers, session-token auth (constant-time, hash-only storage), rate limiting, reap-on-read timeout handling, network-health/backoff/down-state signal, and all 5 UI screens with pt-BR copy - all verified against spec-defined outcomes with `file:line` evidence.

**Issues found**: None blocking. One documented spec-precision gap (QUEUE-18's literal "3 seconds" is not asserted by any test - it's satisfied by the 2s poll-interval design, which is itself precisely tested).

**Next steps**: None required to close out this feature. Optional (not blocking): if the team later wants direct evidence for QUEUE-18's exact bound, add a lightweight test asserting poll-to-visible-update latency, though this would likely require the e2e tier the project explicitly deferred.
