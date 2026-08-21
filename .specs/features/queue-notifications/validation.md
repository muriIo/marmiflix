# Queue Notifications & Seat Limit Validation

**Date**: 2026-08-21
**Spec**: `.specs/features/queue-notifications/spec.md`
**Diff range**: `b467782..899c429` (branch `feat/queue-notifications`, 26 commits)
**Verifier**: independent sub-agent (author ≠ verifier), read-only over the real tree

**Verdict**: ❌ **FAIL** — 2 acceptance criteria have no implementation, 1 spec edge case is unwired, 1 sensor mutant survived.

---

## Task Completion

All 25 tasks (T1–T25) are marked done in `tasks.md`, each with its own atomic commit. Four tasks carry explicitly unchecked manual-verification items, pre-flagged by the implementers — confirmed accurate, not newly discovered here:

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1–T4, T6–T19, T21–T23 | ✅ Done | All `Done when` boxes checked; gates recorded |
| T5 | ✅ Done (1 manual item deferred) | `tasks.md:251` — browser check of the 0:00–5:30 countdown/urgency render not performed (no browser). Code change verified: `components/queue/Heating.tsx:5,23` imports `HEATING_URGENCY_MS`, no local constant remains |
| T20 | ✅ Done (2 manual items deferred) | `tasks.md:665,666` — SW focused/unfocused behavior and `notificationclick` not browser-verified. `node --check` only |
| T24 | ✅ Done (1 manual item deferred) | `tasks.md:781` — queue-full screen + focused-tab chime not browser-verified |
| T25 | ✅ Done (1 manual item deferred) | `tasks.md:810` — join-form opt-in prompt timing not browser-verified; `npm run build` run instead |

The Test Coverage Matrix (`tasks.md:26,27`) declares `components/queue/*.tsx` and `public/sw.js` as having **no automated test layer** in this repo (zero `.tsx` test files exist; no `ServiceWorkerGlobalScope` harness). That declaration is accurate and consistent with the repo. ACs covered *only* by those layers are marked ⚠️ below rather than counted as hidden gaps.

---

## Spec-Anchored Acceptance Criteria

### P1: Get Notified When It's My Turn

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| NOTIF-01 waiting → confirming triggers turn-notification | a turn-ready event for that visitor | `lib/queue/__tests__/with-queue-mutation.integration.test.ts:146` — `expect(notificationJobs).toContainEqual({ scenario: "turn-ready", recipients: [subscription] })` (reap-driven promotion); `:186` (finish-heating promotion); `app/api/queue/__tests__/finish.integration.test.ts:137` — `expect(dispatchAll).toHaveBeenCalledWith([{ scenario: "turn-ready", recipients: [subscription] }])` | ✅ PASS |
| NOTIF-02 focused tab → sound + vibration, no Web Push | audible cue + vibration, no OS push | Suppression logic at `public/sw.js:28-33` — `clientList.filter((client) => client.focused)` → `postMessage`, `return` before `showNotification`. No test layer for `sw.js` | ⚠️ No automated coverage — SW layer; manual/browser verification required, not performed (no browser in the sandboxed environment) |
| NOTIF-03 unfocused + valid subscription → deliver Web Push | `sendNotification` to that subscription with the scenario payload | `lib/notifications/__tests__/dispatcher.test.ts:47-53` — `expect(sendNotification).toHaveBeenCalledTimes(2)`, `expect(firstRecipientArg).toEqual(recipients[0])`, payload `title`/`body` non-empty; `app/api/queue/__tests__/push-subscribe.integration.test.ts:49` — `expect(state.active?.pushSubscription).toEqual(subscription)` | ✅ PASS (server-delivery half). SW's "show when unfocused" half: `public/sw.js:35` — ⚠️ not automated |
| NOTIF-04 no subscription + unfocused → no notification at all | zero jobs emitted | `lib/queue/__tests__/with-queue-mutation.integration.test.ts:279` — `expect(notificationJobs).toEqual([])` | ✅ PASS |
| NOTIF-05 60-second confirm-turn window | deadline = now + 60,000ms | `lib/queue/__tests__/engine.test.ts:397` — `expect(result.active?.deadline).toBe(now + 60_000)` | ✅ PASS |
| NOTIF-06 60s elapses → remove visitor, advance next | reap + promote | `app/api/queue/__tests__/queue-get.integration.test.ts:102` — `expect(body.queueCount).toBe(0)` (reap on read alone); `lib/queue/__tests__/with-queue-mutation.integration.test.ts:146` (promotion produces turn-ready) | ✅ PASS |

### P1: Get Notified As Heating Time Runs Out

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| NOTIF-07 5:00 elapsed → heating-ended event | fires exactly once at 300,000ms | `lib/queue/__tests__/engine.test.ts:657` — `expect(firstCall.fired).toEqual(["heating-ended"])`; `:661` — `expect(secondCall.fired).toEqual([])`; `app/api/queue/__tests__/queue-get.integration.test.ts:130` — `expect(dispatchAll).toHaveBeenCalledWith([{ scenario: "heating-ended", recipients: [subscription] }])` | ✅ PASS |
| NOTIF-08 5:20 elapsed → confirm-finish-ending event | fires exactly once at 320,000ms | `lib/queue/__tests__/engine.test.ts:669` — `expect(result.fired).toEqual(["confirm-finish-ending"])` at `phaseStartedAt + 320_000`; `lib/queue/__tests__/with-queue-mutation.integration.test.ts:220,230` | ✅ PASS |
| NOTIF-09 same focus-based channel rule as turn-notification | sound/vibration focused; push unfocused | Shared dispatch path proven at `app/api/queue/__tests__/queue-get.integration.test.ts:130` (checkpoint jobs go through the same `dispatchAll`). Channel selection itself: `public/sw.js:28-38`, scenario-agnostic | ⚠️ No automated coverage — SW layer; manual/browser verification required, not performed |
| NOTIF-10 heating auto-end 315,000ms → 330,000ms | deadline = now + 330,000ms | `lib/queue/__tests__/engine.test.ts:525` — `expect(result.active?.deadline).toBe(now + 330_000)` | ✅ PASS |
| NOTIF-11 urgency flag window 15s → 30s (5:00–5:30) | flag active for the last 30,000ms | `components/queue/Heating.tsx:23` — `const isUrgent = deadline !== null && remainingMs <= HEATING_URGENCY_MS` with `HEATING_URGENCY_MS = 30_000` (`lib/queue/engine.ts:146`). No `.tsx` test layer | ⚠️ No automated coverage — UI component layer; manual/browser verification required, not performed |
| NOTIF-12 "I'm Done" tappable 0:00–5:30, unchanged | finish accepted throughout heating | `lib/queue/__tests__/engine.test.ts:546` — `applyFinishHeating` promotes next with a fresh deadline; phase-gated only on `phase === "heating"` (`lib/queue/engine.ts:188`) | ✅ PASS (engine level); button render ⚠️ not automated |
| NOTIF-13 5:30 without "I'm Done" → auto-end + advance | reap at deadline = phaseStart + 330,000ms | `lib/queue/__tests__/engine.test.ts:525` (330,000ms deadline) + `lib/queue/engine.ts:57` `reapExpired` at `now > deadline`, exercised at `lib/queue/__tests__/with-queue-mutation.integration.test.ts:112` | ✅ PASS |

### P1: Extensible Notification Dispatch

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| NOTIF-14 all four scenarios through one dispatch interface | single interface, channel selection centralized | `lib/notifications/__tests__/strategies.test.ts:13-23` — `it.each(SCENARIOS)` over all four, `expect(payload.title.length).toBeGreaterThan(0)`; all five routes call the same `dispatchAll` (`app/api/queue/route.ts:20`, `join/route.ts:97`, `confirm-turn/route.ts:53`, `finish/route.ts:57`, `leave/route.ts:53`) | ✅ PASS |
| NOTIF-15 channel selection uses only focus + subscription validity, scenario-independent | no scenario branching in channel logic | `public/sw.js:28-38` — decision is `clientList.filter(c => c.focused)` only; `data.scenario` used solely as the notification `tag`. No test layer | ⚠️ No automated coverage — SW layer; manual/browser verification required, not performed |
| NOTIF-16 a 5th scenario needs only a new call site | no change to channel-selection logic | `lib/notifications/strategies.ts:8` — exhaustive `Record<NotificationScenario, () => NotificationPayload>` (a new union member fails `tsc` until registered); `strategies.test.ts:5-10` parametrized over the union. Spec's Independent Test ("add a throwaway 5th call site") not executed | ⚠️ Spec-precision gap — structural/extensibility property, no runtime-assertable outcome defined |

### P1: Queue Seats Are Capped at 100

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| NOTIF-17 join at 100 (active + waiting) → reject | throws at exactly 100, not at 99 | `lib/queue/__tests__/engine.test.ts:315-317` — `expect(() => applyJoin(...)).toThrow(QueueFullError)` with `expect(state.waiting.length + 1).toBe(100)`; `:342-344` — `.not.toThrow()` at 99 | ✅ PASS |
| NOTIF-18 cap enforced atomically with the join mutation (same CAS semantics) | no concurrent burst exceeds 100 | Cap check lives inside `applyJoin` (`lib/queue/engine.ts:72-75`) which runs inside the CAS loop (`lib/queue/store.ts:127-130`). CAS serialization proven generically at `lib/queue/__tests__/with-queue-mutation.integration.test.ts:12` (QUEUE-19, two concurrent joins into an empty queue). **No test drives concurrent joins at the 99/100 boundary** | ⚠️ Spec-precision gap — mechanism evidenced, the boundary-under-concurrency claim (spec Success Criterion "even under concurrent join attempts at the boundary") is not asserted |
| NOTIF-19 distinct "queue full" outcome, not the generic error path | `409` + `code: "QUEUE_FULL"` | `app/api/queue/__tests__/join.integration.test.ts:124-125` — `expect(response.status).toBe(409)`, `expect(body.code).toBe("QUEUE_FULL")` | ✅ PASS |
| NOTIF-20 client displays a queue-full screen offering waitlist opt-in | `QueueFull` rendered, not a generic error | Error-code plumbing: `hooks/__tests__/useQueue.test.ts:358` — `expect((error as QueueActionError).code).toBe("QUEUE_FULL")`; `:371` — `.toBeUndefined()` for a code-less 409. Rendering: `components/queue/Landing.tsx:35-37,20-22` — no `.tsx` test layer | ⚠️ No automated coverage of the render — UI component layer; manual/browser verification required, not performed (error-code half is ✅ at `useQueue.test.ts:358`) |

### P1: Get Notified When a Seat Opens

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| NOTIF-21 queue-full screen offers opt-in; permission requested only as part of that gesture | opt-in control + gesture-tied permission | Server side: `app/api/queue/__tests__/waitlist-join.integration.test.ts:40` — `expect(entry?.subscription).toEqual(subscription)`, `:41` — `expect(entry?.tokenHash).toBe(hashToken(body.token))`. Gesture: `components/queue/QueueFull.tsx:117` `onClick={handleOptIn}` → `requestPushSubscription()` at `:57` — no `.tsx` test layer | ⚠️ No automated coverage of the gesture binding — UI component layer; manual/browser verification required, not performed (registration half is ✅ at `waitlist-join.integration.test.ts:40`) |
| NOTIF-22 count **drops below** 100 after being at 100 → seat-opened to every registered subscriber at once | broadcast fires on the drop, and only on the drop | Fires-on-drop: `lib/queue/__tests__/with-queue-mutation.integration.test.ts:267` — `expect(notificationJobs).toContainEqual({ scenario: "seat-opened", recipients: [waitlistSub] })`; `app/api/queue/__tests__/leave.integration.test.ts:134`. **Does-not-fire-while-still-full: no assertion anywhere** — sensor mutation M3 (removing the `isFullNow` guard at `lib/queue/store.ts:107`) survived the full gate | ⚠️ Partial — the "drops below" precondition is unasserted (see Sensor / Fix 3) |
| NOTIF-23 focused waitlisted tab → sound/vibration; unfocused + valid subscription → Web Push | same channel-selection rule as the other three | **Focused path is structurally dead.** `components/queue/QueueFull.tsx:40` gates on `data?.scenario === "seat-opened"`, but the push payload is `JSON.stringify(buildNotificationPayload(job.scenario))` (`lib/notifications/dispatcher.ts:57`) = `{ title, body }` only — `lib/notifications/strategies.ts:27-29` returns no `scenario` field. `public/sw.js:31` relays that same object verbatim, so the guard can never be true. `public/sw.js:37` `tag: data.scenario` is likewise always `undefined` | ❌ GAP |
| NOTIF-24 no seat reserved; first to join wins, rest stay waitlisted | broadcast to all, no reservation, no removal | `lib/queue/store.ts:111` — `next.seatWaitlist.map((entry) => entry.subscription)` (all recipients, unconditionally); asserted at `lib/queue/__tests__/with-queue-mutation.integration.test.ts:267`. No reservation/hold code exists in the diff; a broadcast never mutates `seatWaitlist` | ✅ PASS |
| NOTIF-25 waitlisted visitor successfully joins → remove their waitlist registration | registration gone after the join | **Not implemented.** `applyJoin` (`lib/queue/engine.ts:71-115`) never touches `seatWaitlist`; `app/api/queue/join/route.ts:67-70` removes no waitlist entry; `components/queue/Landing.tsx:33` does not call `clearWaitlistIdentity()` or `POST /api/queue/waitlist/leave` on join success. The only removal paths are the explicit user cancel (`waitlist/leave`) and `applyPruneSubscriptions` (itself unwired — see Edge Cases). `lib/__tests__/waitlist-identity.test.ts:9` carries the `NOTIF-25` tag but only asserts `localStorage` round-tripping | ❌ GAP |
| NOTIF-26 visitor can cancel their own registration, authenticated by the opaque token | removed on valid token; rejected + retained on mismatch | `app/api/queue/__tests__/waitlist-leave.integration.test.ts:47,49` — `expect(body.ok).toBe(true)`, `expect(state.seatWaitlist.find(e => e.id === registration.id)).toBeUndefined()`; `:74,77` — `expect(response.status).toBe(403)` and `.toBeDefined()` (not removed); `:56` — `expect(response.status).toBe(404)` | ✅ PASS |

### P2: Opt Into Notifications From the Join Form

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| NOTIF-27 Join form has an opt-in control, unchecked by default | checkbox present, initial state false | `components/queue/Landing.tsx:11` — `useState(false)`; `:89-96` checkbox with `checked={notifyOptIn}`, label "Avisar mesmo se eu fechar a aba" (matches `context.md` copy). No `.tsx` test layer | ⚠️ No automated coverage — UI component layer; manual/browser verification required, not performed |
| NOTIF-28 checked + submit → request permission in that same submit action, never on page load | permission requested inside the submit handler only | `components/queue/Landing.tsx:32` — `const subscription = notifyOptIn ? await requestPushSubscription() : null;` inside `handleJoin`; no module-scope or `useEffect` call anywhere. Helper behavior asserted at `lib/notifications/__tests__/client.test.ts:79` — `expect(result).toEqual({ endpoint, keys })` on the granted path | ⚠️ No automated coverage of the submit-time binding — UI component layer; manual/browser verification required, not performed (helper half is ✅ at `client.test.ts:79`) |
| NOTIF-29 permission denied → join still completes, no subscription, sound/vibration retained | join succeeds with no `subscription` field | `lib/notifications/__tests__/client.test.ts:71` — `await expect(requestPushSubscription()).resolves.toBeNull()` on `"denied"`; `components/queue/Landing.tsx:33` — `join(trimmedName, subscription ?? undefined)`; `hooks/__tests__/useQueue.test.ts:386` — `expect(JSON.parse(init.body as string)).toEqual({ name: "Ana" })` | ✅ PASS |

**Status**: ❌ Gaps present — **16/29 ✅ PASS**, **2 ❌ GAP** (NOTIF-23, NOTIF-25), **3 ⚠️ spec-precision/partial** (NOTIF-16, NOTIF-18, NOTIF-22), **8 ⚠️ no automated coverage** (NOTIF-02, 09, 11, 15, 20, 21, 27, 28 — SW/UI layers, pre-declared in the Test Coverage Matrix).

---

## Discrimination Sensor

Isolated scratch: `git worktree add <scratch> HEAD` from the feature worktree; mutations applied only there; `git worktree remove --force` afterwards. Real-tree `git status --porcelain` was empty before and empty after (baseline match verified).

| # | File:line | Mutation | Gate run | Killed? |
| --- | --- | --- | --- | --- |
| 1 | `lib/queue/engine.ts:73` | Seat-cap off-by-one: `currentSeatCount >= MAX_QUEUE_SEATS` → `> MAX_QUEUE_SEATS` | `test:unit` | ✅ Killed — 1 failed (`engine.test.ts` "throws QueueFullError when the queue is already at the 100-seat cap (NOTIF-17, NOTIF-18)") |
| 2 | `lib/queue/engine.ts:215` | Removed checkpoint idempotence guard: `elapsed >= HEATING_NOMINAL_MS && !alreadyFired.includes("heating-ended")` → `elapsed >= HEATING_NOMINAL_MS` | `test:unit` + `test:integration` | ✅ Killed — 2 unit failures (NOTIF-07, NOTIF-08 checkpoint tests) + 1 integration failure (`with-queue-mutation` checkpoint no-repeat test) |
| 3 | `lib/queue/store.ts:107` | Removed the still-full guard in `buildSeatOpenedJob`: `if (!wasFull \|\| isFullNow)` → `if (!wasFull)` | `test:integration` | ❌ **Survived** — 62/62 passed |
| 4 | `lib/notifications/dispatcher.ts:44` | Dropped 404 from invalid-subscription detection: `statusCode === 404 \|\| statusCode === 410` → `statusCode === 410` | `test:unit` | ✅ Killed — 1 failed (`dispatcher.test.ts` "returns a recipient whose sendNotification rejection carries statusCode 404 as invalid") |

**Mutant 3 is non-equivalent** — proven empirically. A throwaway probe was written in the scratch (a `confirm-turn` mutation on a state seeded at exactly 100 seats with one waitlist subscriber): it **passed** against the unmutated code and **failed** against the mutant. Real-world impact of the missing assertion: any mutation that leaves the count at or above the cap (a `confirm-turn`, a heating poll, a plain GET poll while the queue sits at 100) would broadcast a spurious "Vaga liberada na fila!" push to the entire waitlist on every request. The existing seat-opened tests (`with-queue-mutation.integration.test.ts:233`, `:282`; `leave.integration.test.ts:98`) only cover the legitimate 100→99 drop and the empty-waitlist case; nothing asserts the "drops below" precondition itself.

**Sensor depth**: lightweight (4 mutations, highest-risk new logic)
**Result**: 3/4 killed — ❌ FAIL

---

## Interactive UAT Results

⏭️ **Not performed.** No browser and no human tester are available in this sandboxed environment. This feature is user-facing and the skill's auto-sizing rule does call for Interactive UAT; it remains outstanding. The four pre-flagged manual items in `tasks.md` (T5, T20 ×2, T24, T25) are the concrete checklist for that session and are accurately recorded there. No UAT results are fabricated here.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ — no speculative abstraction; `strategies.ts` registry is the one indirection and it is an explicit spec objective (NOTIF-16) |
| Surgical changes | ✅ — every changed file maps to a task's `Where`; the only non-task edit is `lib/queue/__tests__/view.test.ts` (mechanical `seatWaitlist: []` additions forced by the `QueueState` change) |
| No scope creep | ✅ — nothing in the diff implements anything from the spec's Out of Scope table (no retry/backoff, no multi-device, no reservation, no admin surface, no waitlist cap) |
| Matches patterns | ✅ — new routes clone `confirm-turn/route.ts`'s try/catch→status mapping; `lib/waitlist-identity.ts` clones `lib/identity.ts`; `dispatcher.ts` reuses `redis-client.ts`'s lazy-proxy shape |
| Spec-anchored outcome check (asserted values match spec) | ⚠️ — assertions that exist target exact spec values (60,000 / 330,000 / 320,000 / 409+`QUEUE_FULL` / 404 / 403). Three flagged: NOTIF-16, NOTIF-18, NOTIF-22 |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ⚠️ — routes are complete (happy + 400/403/404/409/429 per route). Domain 1:1 is broken by NOTIF-22's missing negative case and NOTIF-25 having no implementation to test |
| Every test maps to a spec requirement — no unclaimed tests | ✅ — all new tests carry a `NOTIF-xx`/`QUEUE-xx` tag or map to a `Done when` line. One tag is misleading: `lib/__tests__/waitlist-identity.test.ts:9` claims NOTIF-25 but tests only localStorage |
| Documented guidelines followed | ✅ — none exist (no `AGENTS.md`/`CONTRIBUTING.md`); strong defaults applied, floored by existing test depth, as `tasks.md:18` states |
| `SPEC_DEVIATION` markers reviewed | ✅ — one, at `lib/queue/engine.ts:45-49` (carrying `pushSubscription` through `promoteNextToActive`). Correctly flagged, genuinely required by T9's `Done when`, and covered by `with-queue-mutation.integration.test.ts:146` |

---

## Edge Cases

- [x] **Queue count never drops below 100 → waitlisted visitors get no seat-opened notification; registrations never expire.** Correct in code (`lib/queue/store.ts:106-108` `isFullNow` guard; nothing expires `seatWaitlist`) but **not asserted** — this is exactly what surviving mutant 3 exposes.
- [ ] **Stored push subscription rejected 410/404 → discard rather than retry.** ❌ **NOT handled end-to-end.** `lib/notifications/dispatcher.ts:42-45` correctly identifies invalid recipients and `dispatchAll` will call a prune callback — but **no production call site ever passes one**: all five routes call `after(() => dispatchAll(notificationJobs))` with a single argument (`app/api/queue/route.ts:20`, `join/route.ts:97`, `confirm-turn/route.ts:53`, `finish/route.ts:57`, `leave/route.ts:53`). `applyPruneSubscriptions` (`lib/queue/engine.ts:279`) is referenced only by `engine.test.ts`. `design.md:123-124` specified `dispatchAll` performing the prune itself with `lib/queue/store.ts` as a dependency; the implementation made it an unused optional parameter. Invalid subscriptions accumulate in `QueueState` indefinitely.
- [x] **Device lacks Push/Vibration API → queue actions still complete, only the notification channel degrades.** `lib/notifications/__tests__/client.test.ts:65` — `resolves.toBeNull()` when unsupported; `components/queue/Landing.tsx:33` joins regardless; `components/queue/QueueFull.tsx:42` guards `typeof navigator.vibrate === "function"`.
- [x] **Tab closed entirely → delivery attempted exactly as if backgrounded.** Structurally satisfied: the server has no focus/liveness gating — `lib/queue/store.ts:119-151` emits jobs purely from state diffs, and `dispatcher.ts:60` always calls `sendNotification`. Not browser-verifiable here.
- [x] **A waitlist subscription invalid at broadcast time → drop that one delivery without blocking the rest.** `lib/notifications/dispatcher.ts:59` `Promise.allSettled`; `lib/notifications/__tests__/dispatcher.test.ts:116-138` — one stale recipient in a two-recipient `seat-opened` job is collected as invalid while the healthy recipient still resolves.

---

## Gate Check

- **Gate command**: `npm run typecheck && npm run lint && npm run test:unit && npm run test:integration` (Build level, `tasks.md:38`)
- **Result**: exit code **0**. **189 passed, 0 failed, 0 skipped**
  - `typecheck` (`tsc --noEmit`): clean
  - `lint` (`eslint .`): clean
  - `test:unit`: 10 files, **127 passed**
  - `test:integration`: 12 files, **62 passed**
- **Environment note**: Docker is unavailable in this sandbox. Integration tests ran against a local `redis-server` on `127.0.0.1:6399` fronted by an Upstash-REST-compatible shim on `127.0.0.1:8079` (token `local-dev-token`), with `.env.test` pointed at it. Verified live before the run (`["PING"]` → `{"result":"PONG"}`).
- **Test count before feature**: 110 `it`/`it.each` blocks (b467782)
- **Test count after feature**: 183 `it`/`it.each` blocks (189 executed cases after `it.each` expansion)
- **Delta**: +73 blocks. **No test file lost cases** — every pre-existing suite grew or stayed flat; no deletions, no weakened assertions found on inspection of the diff.
- **Skipped tests**: none
- **Failures**: none

---

## Fix Plans

### Fix 1: Push payload omits `scenario`, breaking the seat-opened focused-tab channel (NOTIF-23)

- **Priority**: **Blocker** (a P1 acceptance criterion is structurally unreachable)
- **Root cause**: `lib/notifications/dispatcher.ts:57` serializes only `buildNotificationPayload(job.scenario)` → `{ title, body }`. `design.md:144` specifies the relayed payload as `{ scenario, title, body }`. Both consumers depend on the missing field: `components/queue/QueueFull.tsx:40` (`data?.scenario === "seat-opened"` — never true) and `public/sw.js:37` (`tag: data.scenario` — always `undefined`, so notifications never coalesce per scenario).
- **Fix task**:
  - *What*: Include the scenario in the serialized push payload.
  - *Where*: `lib/notifications/dispatcher.ts:57` — `JSON.stringify({ scenario: job.scenario, ...buildNotificationPayload(job.scenario) })`.
  - *Verify*: Strengthen `lib/notifications/__tests__/dispatcher.test.ts:50-53` to assert `expect(parsedPayload.scenario).toBe("turn-ready")`, and add an `it.each` over all four scenarios asserting the payload's `scenario` round-trips.
  - *Done when*: the payload sent to `sendNotification` contains `scenario`, `title`, and `body`; the new assertion fails if `scenario` is dropped again.

### Fix 2: A successful join never clears the visitor's waitlist registration (NOTIF-25)

- **Priority**: **Major**
- **Root cause**: No task in `tasks.md` was assigned the removal behavior — T23's `Requirement: NOTIF-25, NOTIF-26` covers only `localStorage` persistence, so the AC fell through the plan. Neither the server (`app/api/queue/join/route.ts`) nor the client (`components/queue/Landing.tsx:33`) removes the registration on a successful join.
- **Fix task**:
  - *What*: On a successful join, remove the caller's waitlist registration.
  - *Where*: Preferred (authenticated, server-side): accept an optional `waitlistId`/`waitlistToken` on `POST /api/queue/join` and drop the matching `seatWaitlist` entry inside the same CAS mutation as `applyJoin` (reuse `verifyToken`, mirroring `app/api/queue/waitlist/leave/route.ts:24-37`). Client: `components/queue/Landing.tsx` reads `getWaitlistIdentity()`, forwards it on join, and calls `clearWaitlistIdentity()` on success.
  - *Verify*: New integration case in `app/api/queue/__tests__/join.integration.test.ts` — register on the waitlist, free a seat, join with the waitlist credentials, then assert `expect(state.seatWaitlist.find(e => e.id === registration.id)).toBeUndefined()`. Add a negative case asserting a bad `waitlistToken` leaves the entry in place and does not fail the join.
  - *Done when*: spec.md's Independent Test for the seat-opened story ("join immediately after and verify the waitlist registration is gone") is asserted by an automated test.

### Fix 3: Seat-opened broadcast has no "count actually dropped" assertion (NOTIF-22, surviving mutant 3)

- **Priority**: **Major**
- **Root cause**: Test-coverage gap, not a code defect — `lib/queue/store.ts:106-108` is correct today, but nothing pins the `isFullNow` half of the guard, so a future edit silently turns every poll at a full queue into a waitlist-wide broadcast.
- **Fix task**:
  - *What*: Add the negative integration case the mutant escaped through.
  - *Where*: `lib/queue/__tests__/with-queue-mutation.integration.test.ts` (alongside the existing seat-opened cases at `:233` and `:282`).
  - *Verify*: Seed a state at exactly 100 seats (active `confirming` + 99 waiting) with one `seatWaitlist` subscriber; run a mutation that leaves the count at 100 (e.g. `applyConfirmTurn`); assert `expect(notificationJobs.some(j => j.scenario === "seat-opened")).toBe(false)`. This exact probe was confirmed to pass on current code and fail on the mutant.
  - *Done when*: re-running sensor mutation 3 (`if (!wasFull || isFullNow)` → `if (!wasFull)`) fails the integration gate.

### Fix 4: 404/410 subscription pruning is never wired to a call site (spec Edge Case 2)

- **Priority**: **Major**
- **Root cause**: T8 scoped the prune callback as an optional `dispatchAll` parameter, and no later task wired it. `design.md:123-124` intended `dispatchAll` to perform the prune itself. Result: `applyPruneSubscriptions` is dead outside tests and invalid subscriptions are never discarded.
- **Fix task**:
  - *What*: Have every dispatch site actually prune invalid endpoints.
  - *Where*: Add a `pruneInvalidSubscriptions(endpoints)` helper (e.g. in `lib/notifications/dispatcher.ts` or a thin wrapper) that runs `withQueueMutation((state) => ({ next: applyPruneSubscriptions(state, endpoints), result: null }))`, and pass it from `dispatchAll` — or make `dispatchAll` default to it — so the five `after(() => dispatchAll(jobs))` sites at `app/api/queue/route.ts:20`, `join/route.ts:97`, `confirm-turn/route.ts:53`, `finish/route.ts:57`, `leave/route.ts:53` get pruning without each re-plumbing it.
  - *Verify*: Integration test — seed an entry with a subscription, mock `web-push` to reject it with `statusCode: 410`, trigger a dispatching route, then assert `expect(state.active?.pushSubscription).toBeUndefined()`. Add the `seatWaitlist` equivalent.
  - *Done when*: a 410/404 rejection observably removes the subscription from `QueueState`, satisfying spec.md's edge case end-to-end.

### Fix 5 (optional, lower priority): Seat-cap concurrency at the boundary (NOTIF-18)

- **Priority**: **Minor**
- **Root cause**: The cap is structurally inside the CAS loop and almost certainly correct; only the boundary-specific assertion is absent.
- **Fix task**: In `lib/queue/__tests__/with-queue-mutation.integration.test.ts`, seed 99 seats, fire two concurrent `applyJoin` mutations, and assert exactly one succeeds and the other throws `QueueFullError`, with the final `seatCount(state)` equal to 100 — mirroring the existing QUEUE-19 concurrency test at `:12`.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| NOTIF-01, 04, 05, 06, 07, 08, 10, 13, 14, 17, 19, 24, 26, 29 | Implementing | ✅ Verified |
| NOTIF-03, 12 | Implementing | ✅ Verified (server/engine half; SW/UI half pending manual UAT) |
| NOTIF-02, 09, 11, 15, 20, 21, 27, 28 | Implementing | ⚠️ Verified by code inspection — pending manual/browser UAT (no automated test layer by design) |
| NOTIF-16 | Implementing | ⚠️ Spec-precision gap (extensibility property, Independent Test not executed) |
| NOTIF-18 | Implementing | ⚠️ Spec-precision gap (boundary-under-concurrency unasserted) — Fix 5 |
| NOTIF-22 | Implementing | ⚠️ Partial — "drops below" precondition unasserted — Fix 3 |
| NOTIF-23 | Implementing | ❌ Needs Fix — Fix 1 |
| NOTIF-25 | Implementing | ❌ Needs Fix — Fix 2 |

---

## Summary

**Overall**: ❌ Not Ready

**Spec-anchored check**: 16/29 ACs matched the spec-defined outcome exactly; 2 gaps; 3 spec-precision/partial flags; 8 not automated (SW/UI layers, pre-declared in the Test Coverage Matrix)
**Sensor**: 3/4 mutations killed — 1 survived
**Gate**: 189 passed, 0 failed, 0 skipped (exit 0)

**What works**: The engine changes are precise and well covered — the 60s confirm window, the 330,000ms heating deadline, both heating checkpoints with real idempotence, and the 100-seat cap with exact-boundary tests all assert the literal spec values. The CAS-level notification-job diffing is genuinely tested against real Redis across all four trigger paths (join, reap, finish, leave). All three new endpoints cover happy path plus 400/403/404/429. The dispatcher isolates per-recipient failures correctly and distinguishes 404/410 from 5xx. Error-code plumbing through `useQueue` is exact. No test was deleted or weakened; +73 test blocks.

**Issues found**:
1. **NOTIF-23 (Blocker)** — the push payload omits `scenario`, so the seat-opened focused-tab chime in `QueueFull.tsx:40` can never fire and `sw.js`'s notification `tag` is always undefined. Fix 1.
2. **NOTIF-25 (Major)** — a successful join never removes the visitor's waitlist registration; the AC was never assigned to a task. Fix 2.
3. **Surviving mutant / NOTIF-22 (Major)** — nothing asserts that the seat count must actually *drop below* the cap before broadcasting. Fix 3.
4. **Spec Edge Case 2 (Major)** — 404/410 subscription pruning is implemented but never wired to any call site; `applyPruneSubscriptions` is dead code in production. Fix 4.
5. **NOTIF-18 (Minor)** — no boundary-under-concurrency test for the seat cap. Fix 5.

**Known, pre-flagged, non-blocking**: the SW (`public/sw.js`) and UI (`components/queue/*.tsx`) layers have no automated test path in this repo — declared up front in `tasks.md:26-30` and carried as unchecked manual items on T5, T20, T24, T25. These are correctly documented, not hidden. They remain outstanding pending a browser session.

**Next steps**: Route Fixes 1–4 back to an implementer (Fix 1 first — it is a one-line change unblocking a P1 AC). Re-verify, then run the deferred Interactive UAT in a browser to close NOTIF-02, 09, 11, 15, 20, 21, 27, 28 and the four manual task items.
