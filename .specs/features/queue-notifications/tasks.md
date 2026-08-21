# Queue Notifications & Seat Limit Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/queue-notifications/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase sampling. Guidelines found: none (no `AGENTS.md`/`CONTRIBUTING.md`) - strong defaults applied, floored by existing test depth (`lib/queue/__tests__/`, `app/api/queue/__tests__/`, `hooks/__tests__/`).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domain logic - `lib/queue/engine.ts`, `lib/notifications/strategies.ts`, `lib/notifications/dispatcher.ts` | unit | All branches; 1:1 to spec ACs; every listed edge case covered (mock `web-push` at the dispatcher boundary - no real network calls) | `lib/**/__tests__/*.test.ts` | `npm run test:unit` |
| CAS orchestration - `lib/queue/store.ts` | integration (needs real Redis - existing `docker-compose.test.yml` stack) | Every new behavior added to `withQueueMutation` (checkpoint firing, turn-ready/seat-opened job diffing) against real CAS writes | `lib/queue/__tests__/*.integration.test.ts` | `npm run test:integration` |
| Route handlers - `app/api/queue/**/route.ts` (existing + new) | integration | Happy path + every listed edge case + error/failure paths, per route | `app/api/queue/__tests__/*.integration.test.ts` | `npm run test:integration` |
| Browser helpers - `lib/notifications/client.ts`, `hooks/useQueue.ts`, `lib/waitlist-identity.ts` | unit (jsdom via `// @vitest-environment jsdom`, mocking `Notification`/`navigator.serviceWorker`/`PushManager`/`localStorage`) | Every branch (granted/denied/unsupported; success/failure) | `lib/**/__tests__/*.test.ts`, `hooks/__tests__/*.test.ts` | `npm run test:unit` |
| UI components - `components/queue/*.tsx` | none | Matches existing repo convention (zero `.tsx` test files today) - verified via Interactive UAT instead | n/a | manual (Interactive UAT) |
| Service worker - `public/sw.js` | none | Not runnable under jsdom/vitest (no `ServiceWorkerGlobalScope`, no `self.clients`); no SW test harness exists in this repo | n/a | manual (browser devtools: Application → Service Workers, trigger a test push) |
| Config/docs - `.env.example`, `DEPLOYMENT.md` | none | Build gate only | n/a | build gate only |

**Coverage gaps accepted and flagged (not silently skipped):** UI components and `sw.js` have no automated test path in this stack. Both are covered by Interactive UAT at the end of Execute (this feature is Complex/user-facing, which triggers Interactive UAT per the skill's auto-sizing rule regardless).

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After tasks with unit tests only | `npm run test:unit` |
| Full | After tasks with integration tests | `npm run test:unit && npm run test:integration` (requires `docker compose -f docker-compose.test.yml up -d` running) |
| Build | After phase completion or config/entity-only tasks | `npm run typecheck && npm run lint && npm run test:unit && npm run test:integration` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Data Model & Engine Foundations

```
T1 → T2 → T5
T1 → T3
T1 → T4
```

### Phase 2: Notification Dispatch Infrastructure

```
T6 → T7 → T8
T6 → T9
```

### Phase 3: Route Wiring (Existing Routes)

```
T10
T11
T12
T13
T14
```

### Phase 4: New Push/Waitlist Endpoints + Config

```
T16 → T17
T18 → T19
T15
```

### Phase 5: Client-Side Push Runtime

```
T20 → T21
```

### Phase 6: UI Wiring

```
T23 → T24 → T25
T22 → T25
```

### Cross-Phase Dependency Edges

Every task above also depends on one or more tasks from an earlier phase (backward-only, verified by the forward-phase-dependency check). Listed here as explicit edges - one per `Depends on` reference to a task outside the current phase - so the diagram is a complete, checkable picture of the full dependency graph, not just each phase's internal order:

```
T1 -> T6
T1 -> T16
T2 -> T11
T3 -> T9
T4 -> T9
T4 -> T15
T6 -> T21
T6 -> T22
T9 -> T10
T9 -> T11
T9 -> T12
T9 -> T13
T9 -> T14
T11 -> T25
T16 -> T24
T17 -> T24
T21 -> T24
T21 -> T25
```

---

## Task Breakdown

### T1: Extend queue types for push subscriptions, checkpoints, waitlist, and the seat-cap error

**What**: Add `PushSubscriptionRecord`, `HeatingCheckpoint`, `SeatWaitlistEntry`, `QueueFullError` to `lib/queue/types.ts`; extend `WaitingEntry`/`ActiveEntry` with optional `pushSubscription`; extend `ActiveEntry` with optional `notifiedCheckpoints`; extend `QueueState` with `seatWaitlist: SeatWaitlistEntry[]`.
**Where**: `lib/queue/types.ts`
**Depends on**: None
**Reuses**: Existing error-class shape (`class X extends Error { constructor() { super(...); this.name = "X"; } }`) already used by `DuplicateNameError`/`NotFoundError`/etc.
**Requirement**: NOTIF-01, NOTIF-08, NOTIF-19, NOTIF-21

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] All four new/extended types compile and are exported
- [x] `emptyState()`-style helpers used by existing tests still typecheck with `seatWaitlist: []` required
- [x] No TypeScript errors: `npm run typecheck`

**Tests**: none
**Gate**: build

**Commit**: `feat(queue-types): add push subscription, checkpoint, waitlist, and seat-cap types`

---

### T2: Widen timing windows, add the 100-seat cap, and accept an optional subscription on join

**What**: In `lib/queue/engine.ts`: change `CONFIRM_WINDOW_MS` 20,000 → 60,000; replace the implicit 315,000 with explicit `HEATING_NOMINAL_MS = 300_000`, `HEATING_URGENCY_MS = 30_000`, `HEATING_WINDOW_MS = HEATING_NOMINAL_MS + HEATING_URGENCY_MS` (all exported); add `export const MAX_QUEUE_SEATS = 100`; in `applyJoin`, throw `QueueFullError` when `(active ? 1 : 0) + waiting.length >= MAX_QUEUE_SEATS`, checked before the name/duplicate checks; extend `JoinInput` with an optional `pushSubscription?: PushSubscriptionRecord`, attached to whichever entry (active-via-empty-queue or waiting) gets created.
**Where**: `lib/queue/engine.ts`
**Depends on**: T1
**Reuses**: Existing `applyJoin` structure, `promoteNextToActive`, `isNameTaken`
**Requirement**: NOTIF-05, NOTIF-10, NOTIF-11, NOTIF-17, NOTIF-18

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `applyJoin` throws `QueueFullError` when count is already 100, and does NOT throw at 99
- [x] `applyConfirmTurn`'s resulting deadline reflects the new 60,000ms window
- [x] `promoteNextToActive`'s resulting deadline reflects the new 60,000ms window
- [x] `applyConfirmTurn`'s heating deadline reflects the new 330,000ms window
- [x] A join with a `pushSubscription` stores it on the created entry (active-path and waiting-path both covered)
- [x] Gate check passes: `npm run test:unit`
- [x] Test count: existing `engine.test.ts` suite (currently ~size in repo) plus at least 6 new cases (cap-reject-at-100, cap-allow-at-99, subscription-stored-active-path, subscription-stored-waiting-path, 60s confirm deadline, 330s heating deadline) - no silent deletions of existing cases

**Tests**: unit
**Gate**: quick

**Commit**: `feat(queue-engine): widen confirm/heating windows and enforce the 100-seat cap`

---

### T3: Detect the 5:00 and 5:20 heating checkpoints

**What**: Add `applyHeatingCheckpoints(state: QueueState, now: number): { state: QueueState; fired: HeatingCheckpoint[] }` to `lib/queue/engine.ts` - a no-op unless `state.active?.phase === "heating"`; computes elapsed time from `phaseStartedAt`; for each of the two checkpoints (`heating-ended` at 300,000ms, `confirm-finish-ending` at 320,000ms) not already present in `state.active.notifiedCheckpoints`, adds it to the returned `fired` list and to the returned state's `notifiedCheckpoints`.
**Where**: `lib/queue/engine.ts`
**Depends on**: T1
**Reuses**: Same pure-function style as `reapExpired`
**Requirement**: NOTIF-07, NOTIF-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Returns `{ state, fired: [] }` unchanged (same reference) when there's no active entry or phase isn't "heating"
- [x] Fires `heating-ended` exactly once when elapsed crosses 300,000ms, not again on a later call with the same `notifiedCheckpoints`
- [x] Fires `confirm-finish-ending` exactly once when elapsed crosses 320,000ms
- [x] Both fire together (same call) when elapsed is checked for the first time past 320,000ms (e.g. state resumed after a gap)
- [x] Gate check passes: `npm run test:unit`
- [x] Test count: 5 new test cases minimum

**Tests**: unit
**Gate**: quick

**Commit**: `feat(queue-engine): detect heating-ended and confirm-finish-ending checkpoints`

---

### T4: Attach and prune push subscriptions on an existing entry

**What**: Add `applyAttachPushSubscription(state: QueueState, input: IdentifiedInput & { subscription: PushSubscriptionRecord }): QueueState` (throws `NotFoundError`/`ForbiddenError` via the same lookup pattern as `applyConfirmTurn`) and `applyPruneSubscriptions(state: QueueState, invalidEndpoints: string[]): QueueState` (strips any `pushSubscription`, or `seatWaitlist` entry, whose `endpoint` matches) to `lib/queue/engine.ts`.
**Where**: `lib/queue/engine.ts`
**Depends on**: T1
**Reuses**: The `NotFoundError`/`ForbiddenError` lookup shape already used by `applyConfirmTurn`/`applyFinishHeating`
**Requirement**: NOTIF-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `applyAttachPushSubscription` attaches to the active entry when the id matches active, to the matching waiting entry otherwise, throws `NotFoundError` if neither matches, throws `ForbiddenError` on a hash mismatch
- [x] `applyPruneSubscriptions` removes a matching `pushSubscription` from active/waiting entries and a matching `seatWaitlist` entry, leaves everything else untouched
- [x] Gate check passes: `npm run test:unit`
- [x] Test count: 6 new test cases minimum

**Tests**: unit
**Gate**: quick

**Commit**: `feat(queue-engine): add push-subscription attach and prune operations`

---

### T5: Sync the heating urgency window in the UI with the new engine constant

**What**: In `components/queue/Heating.tsx`, replace the locally hardcoded `const URGENCY_WINDOW_MS = 15_000` with an import of `HEATING_URGENCY_MS` from `lib/queue/engine.ts` (now 30,000 per T2), and use it wherever `URGENCY_WINDOW_MS` was referenced.
**Where**: `components/queue/Heating.tsx`
**Depends on**: T2
**Reuses**: Existing `phaseStartedAt`/`remainingMs`/`isUrgent` computation - only the constant's source changes
**Requirement**: NOTIF-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] No local `URGENCY_WINDOW_MS` constant remains in the file
- [x] The urgency visual flag now activates in the last 30s (5:00-5:30) instead of 15s
- [x] No TypeScript errors: `npm run typecheck`
- [ ] Manually verified in a running `next dev` session that the countdown display and urgency styling still render correctly across the full 0:00-5:30 range (component has no automated test layer in this repo) - NOT performed by this batch worker (no browser/interactive session available in this sandboxed environment); the code change is a mechanical constant-source swap only, logic otherwise untouched. Flagged as a deferred manual-verification item, consistent with this component's existing no-automated-test-layer status.

**Tests**: none
**Gate**: quick

**Commit**: `fix(heating-ui): derive urgency window from the shared engine constant`

---

### T6: Define the notification-scenario vocabulary

**What**: Create `lib/notifications/types.ts` exporting `type NotificationScenario = "turn-ready" | "heating-ended" | "confirm-finish-ending" | "seat-opened"` and `interface NotificationJob { scenario: NotificationScenario; recipients: PushSubscriptionRecord[] }`.
**Where**: `lib/notifications/types.ts`
**Depends on**: T1
**Reuses**: `PushSubscriptionRecord` from `lib/queue/types.ts`
**Requirement**: NOTIF-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Both types exported and compile
- [x] No TypeScript errors: `npm run typecheck`

**Tests**: none
**Gate**: build

**Commit**: `feat(notifications): define scenario and job types`

---

### T7: Build the per-scenario content strategy registry

**What**: Create `lib/notifications/strategies.ts` exporting `buildNotificationPayload(scenario: NotificationScenario): { title: string; body: string }`, backed by a `Record<NotificationScenario, () => {title, body}>` registry with pt-BR copy for all four scenarios (this is the "strategy pattern" registry Objective 4 asked for - a future 5th scenario is one new entry here).
**Where**: `lib/notifications/strategies.ts`
**Depends on**: T6
**Reuses**: pt-BR tone/style already established in `components/queue/*.tsx` copy (e.g. "Chegou a sua vez", "Aquecendo")
**Requirement**: NOTIF-14, NOTIF-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] All four scenarios return a non-empty `title` and `body`
- [x] Calling with each of the four `NotificationScenario` values is covered by a test
- [x] Gate check passes: `npm run test:unit`
- [x] Test count: 4 new test cases minimum

**Tests**: unit
**Gate**: quick

**Commit**: `feat(notifications): add pt-BR content strategy registry`

---

### T8: Send a notification job via web-push, tolerating per-recipient failure

**What**: Add the `web-push` dependency (`npm install web-push` + `npm install -D @types/web-push`). Create `lib/notifications/dispatcher.ts`: configure `webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)` once from env vars at module load (lazily, mirroring `lib/queue/redis-client.ts`'s proxy pattern so a missing env var doesn't break `next build`'s page-data collection); export `dispatchNotificationJob(job: NotificationJob): Promise<PushSubscriptionRecord[]>` - sends via `Promise.allSettled`, returns the recipients whose rejection carried `statusCode` 404 or 410; export `dispatchAll(jobs: NotificationJob[]): Promise<void>` - runs every job, collects all invalid recipients across jobs, and calls a provided prune callback (or is a no-op if none invalid); never throws (delivery failure is logged and swallowed, per design.md's Error Handling Strategy).
**Where**: `lib/notifications/dispatcher.ts`
**Depends on**: T7
**Reuses**: The lazy-proxy-for-env-vars pattern from `lib/queue/redis-client.ts`
**Requirement**: NOTIF-03, NOTIF-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `web-push` is a `dependencies` entry (not `devDependencies`) in `package.json`; `@types/web-push` is a `devDependencies` entry
- [x] `dispatchNotificationJob` calls `webpush.sendNotification` once per recipient with the strategy-built payload as JSON
- [x] A `statusCode: 410` (or 404) rejection is returned in the invalid-recipients list; a `statusCode: 500` rejection is swallowed (not returned as invalid, not thrown)
- [x] `dispatchAll` never rejects even when every recipient fails
- [x] `web-push` is mocked in tests (`vi.mock("web-push", ...)`) - no real network calls
- [x] Gate check passes: `npm run test:unit`
- [x] Test count: 5 new test cases minimum

**Tests**: unit
**Gate**: quick

**Commit**: `feat(notifications): add web-push dispatcher with per-recipient failure isolation`

---

### T9: Wire checkpoint detection and notification-job diffing into the CAS mutation loop

**What**: In `lib/queue/store.ts`: change `withQueueMutation<T>`'s return type from `Promise<T>` to `Promise<{ result: T; notificationJobs: NotificationJob[] }>`; after `reapExpired`, run `applyHeatingCheckpoints` and map any `fired` checkpoints to `NotificationJob`s targeting `checkpointed.active.pushSubscription` (skip if absent); after `mutate` produces `next`, diff `checkpointed` (before) vs `next` (after) for: (a) a `turn-ready` job when `next.active?.phase === "confirming"` and (`checkpointed.active?.id !== next.active.id` or `checkpointed.active?.phase !== "confirming"`), targeting `next.active.pushSubscription`; (b) a `seat-opened` broadcast job when `(checkpointed.active?1:0)+checkpointed.waiting.length >= 100` and the equivalent count for `next` is `< 100`, targeting every `next.seatWaitlist[].subscription`; every job with zero recipients (no subscription present) is omitted entirely, not included as an empty job.
**Where**: `lib/queue/store.ts`
**Depends on**: T3, T4, T6
**Reuses**: The existing CAS retry loop - unchanged; `reapExpired`'s established pattern for the new checkpoint step
**Requirement**: NOTIF-01, NOTIF-07, NOTIF-08, NOTIF-22

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A join into an empty queue (with a subscription) produces a `turn-ready` job in the same call
- [x] A confirm-turn-timeout reap (via a GET poll past the deadline) produces a `turn-ready` job for the newly promoted entry
- [x] A finish-heating that promotes the next waiting entry produces a `turn-ready` job for them
- [x] A poll that crosses the 5:00/5:20 heating elapsed marks produces the corresponding checkpoint job(s), and does not repeat them on a subsequent poll
- [x] A leave/finish/timeout that drops the count from 100 to 99 produces a `seat-opened` job addressed to every current `seatWaitlist` subscriber
- [x] No entry without a `pushSubscription` ever produces a job with zero recipients
- [x] All 5 existing call sites (`app/api/queue/*/route.ts`) still typecheck against the new return shape (this task only changes `store.ts`; call sites are fixed in Phase 3, so a transient typecheck failure across the workspace is expected and resolved by the end of Phase 3 - `npm run test:unit`/`typecheck` for the whole repo is not the gate for this task specifically)
- [x] Gate check passes: `npm run test:integration` (targeting `lib/queue/__tests__/with-queue-mutation.integration.test.ts` and `store.integration.test.ts`)
- [x] Test count: 6 new integration test cases minimum

**Tests**: integration
**Gate**: full

**Commit**: `feat(queue-store): detect notification-triggering transitions during CAS mutation`

---

### T10: Wire notification dispatch into the queue read route

**What**: In `app/api/queue/route.ts`, destructure `withQueueMutation`'s new `{ result, notificationJobs }` shape; when `notificationJobs.length > 0`, call `after(() => dispatchAll(notificationJobs))` (imported from `next/server`) before returning the response.
**Where**: `app/api/queue/route.ts`
**Depends on**: T9
**Reuses**: `after()` (`next/server`, stable since Next 15.1)
**Requirement**: NOTIF-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `GET` still returns the same `QueueView` JSON shape as before, unchanged status/body for the caller
- [x] `after()` is called only when `notificationJobs` is non-empty
- [x] Existing `queue-get.integration.test.ts` suite still passes unmodified in its assertions on the response body
- [x] A new test asserts that a poll crossing a heating checkpoint results in `dispatchAll` being invoked (mock/spy on the module) with the expected job
- [x] Gate check passes: `npm run test:integration`
- [x] Test count: existing suite + 1 new case minimum

**Tests**: integration
**Gate**: full

**Commit**: `feat(queue-api): dispatch notification jobs after a queue read`

---

### T11: Accept an optional subscription on join, map the seat-cap error, and dispatch notifications

**What**: In `app/api/queue/join/route.ts`: accept an optional `subscription` field from the request body (typed as `unknown`, validated as `{endpoint: string, keys: {p256dh: string, auth: string}}` before use, `undefined` otherwise) and pass it through to `applyJoin`'s `pushSubscription`; catch `QueueFullError` and respond `409 { error: error.message, code: "QUEUE_FULL" }`; destructure the new `withQueueMutation` return shape and call `after(() => dispatchAll(notificationJobs))` when non-empty.
**Where**: `app/api/queue/join/route.ts`
**Depends on**: T9, T2
**Reuses**: The existing try/catch → typed-error → status-code shape already in this file
**Requirement**: NOTIF-17, NOTIF-19, NOTIF-20, NOTIF-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A join at 100/100 returns `409` with `code: "QUEUE_FULL"` (distinct from the existing duplicate-name `409`, which has no `code` field)
- [ ] A join with a well-formed `subscription` field stores it (verified indirectly via a follow-up `push-subscribe`-shaped assertion or a direct state read in the test)
- [ ] A join with a malformed or missing `subscription` field succeeds exactly as before (no subscription attached, no error)
- [ ] A join into an empty queue with a subscription results in `after()`/`dispatchAll` NOT being called (no one else to notify - the joiner IS the new active entry, not a job target)
- [ ] Existing `join.integration.test.ts` suite still passes unmodified in its existing assertions
- [ ] Gate check passes: `npm run test:integration`
- [ ] Test count: existing suite + 4 new cases minimum

**Tests**: integration
**Gate**: full

**Commit**: `feat(queue-api): accept push subscriptions on join and surface the seat-cap error`

---

### T12: Wire notification dispatch into the confirm-turn route

**What**: In `app/api/queue/confirm-turn/route.ts`, destructure the new `withQueueMutation` return shape and call `after(() => dispatchAll(notificationJobs))` when non-empty (mechanical - mirrors T10).
**Where**: `app/api/queue/confirm-turn/route.ts`
**Depends on**: T9
**Reuses**: Same pattern as T10
**Requirement**: NOTIF-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Existing `confirm-turn.integration.test.ts` suite passes unmodified
- [ ] `POST` response shape/status codes unchanged
- [ ] Gate check passes: `npm run test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(queue-api): dispatch notification jobs after confirm-turn`

---

### T13: Wire notification dispatch into the finish route

**What**: In `app/api/queue/finish/route.ts`, destructure the new `withQueueMutation` return shape and call `after(() => dispatchAll(notificationJobs))` when non-empty (mechanical - mirrors T10). This is the route most likely to produce both a `turn-ready` job (promoting the next waiting entry) and, when the queue was at 100, a `seat-opened` job in the same call.
**Where**: `app/api/queue/finish/route.ts`
**Depends on**: T9
**Reuses**: Same pattern as T10
**Requirement**: NOTIF-01, NOTIF-22

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Existing `finish.integration.test.ts` suite passes unmodified
- [ ] A finish that promotes the next waiting entry (with a subscription) results in `dispatchAll` receiving a `turn-ready` job
- [ ] Gate check passes: `npm run test:integration`
- [ ] Test count: existing suite + 1 new case minimum

**Tests**: integration
**Gate**: full

**Commit**: `feat(queue-api): dispatch notification jobs after finish`

---

### T14: Wire notification dispatch into the leave route

**What**: In `app/api/queue/leave/route.ts`, destructure the new `withQueueMutation` return shape and call `after(() => dispatchAll(notificationJobs))` when non-empty (mechanical - mirrors T10). This is the route that can produce a `seat-opened` job when a waiting visitor leaves a full queue.
**Where**: `app/api/queue/leave/route.ts`
**Depends on**: T9
**Reuses**: Same pattern as T10
**Requirement**: NOTIF-22

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Existing `leave.integration.test.ts` suite passes unmodified
- [ ] A leave that drops the count from 100 to 99 results in `dispatchAll` receiving a `seat-opened` broadcast job addressed to the current waitlist
- [ ] Gate check passes: `npm run test:integration`
- [ ] Test count: existing suite + 1 new case minimum

**Tests**: integration
**Gate**: full

**Commit**: `feat(queue-api): dispatch notification jobs after leave`

---

### T15: Add the push-subscription attach endpoint

**What**: Create `app/api/queue/push-subscribe/route.ts`: `POST` body `{ id, sessionToken, subscription }` → `checkRateLimit` → `authorizeEntry` (existing) → `withQueueMutation` wrapping `applyAttachPushSubscription` → `{ ok: true }`; same error-status mapping as `confirm-turn/route.ts` (404/403/409).
**Where**: `app/api/queue/push-subscribe/route.ts`
**Depends on**: T4
**Reuses**: `authorizeEntry`, `checkRateLimit`, `withQueueMutation`, the exact try/catch shape of `confirm-turn/route.ts`
**Requirement**: NOTIF-03, NOTIF-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A valid `id`/`sessionToken`/`subscription` for an existing entry (active or waiting) attaches the subscription and returns `200 { ok: true }`
- [ ] An unknown `id` returns `404`
- [ ] A mismatched `sessionToken` returns `403`
- [ ] A malformed `subscription` shape returns `400`
- [ ] Rate limiting matches the existing per-route pattern (429 after the threshold)
- [ ] Gate check passes: `npm run test:integration`
- [ ] Test count: 5 new integration test cases minimum

**Tests**: integration
**Gate**: full

**Commit**: `feat(queue-api): add push-subscribe endpoint`

---

### T16: Add the waitlist join endpoint

**What**: Create `app/api/queue/waitlist/join/route.ts`: `POST` body `{ subscription }` → `checkRateLimit` → mints `id` (`randomUUID`) + opaque token (`generateSessionToken`/`hashToken`, reused) → `withQueueMutation` appending a `SeatWaitlistEntry` to `state.seatWaitlist` → returns `{ id, token }`.
**Where**: `app/api/queue/waitlist/join/route.ts`
**Depends on**: T1
**Reuses**: `generateSessionToken`, `hashToken`, `checkRateLimit`, `withQueueMutation`
**Requirement**: NOTIF-21

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A valid `subscription` registers a waitlist entry and returns `200 { id, token }`
- [ ] A malformed `subscription` shape returns `400`
- [ ] Registering twice with two different subscriptions creates two distinct entries (no dedup required - each is independently cancellable)
- [ ] Rate limiting matches the existing per-route pattern
- [ ] Gate check passes: `npm run test:integration`
- [ ] Test count: 4 new integration test cases minimum

**Tests**: integration
**Gate**: full

**Commit**: `feat(queue-api): add seat-opened waitlist join endpoint`

---

### T17: Add the waitlist leave (cancel) endpoint

**What**: Create `app/api/queue/waitlist/leave/route.ts`: `POST` body `{ id, token }` → verify token hash against the matching `seatWaitlist` entry (`verifyToken`, reused; `404` if no entry with that id, `403` on hash mismatch) → `withQueueMutation` removing that entry → `{ ok: true }`.
**Where**: `app/api/queue/waitlist/leave/route.ts`
**Depends on**: T16
**Reuses**: `verifyToken`, `checkRateLimit`, `withQueueMutation`
**Requirement**: NOTIF-26

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A valid `id`/`token` pair (from a prior `waitlist/join` call) removes that entry and returns `200 { ok: true }`
- [ ] An unknown `id` returns `404`
- [ ] A mismatched `token` returns `403` and does NOT remove the entry
- [ ] Gate check passes: `npm run test:integration`
- [ ] Test count: 4 new integration test cases minimum

**Tests**: integration
**Gate**: full

**Commit**: `feat(queue-api): add seat-opened waitlist leave endpoint`

---

### T18: Document the VAPID environment variables

**What**: Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to `.env.example`, following the file's existing commented-block style, with a note that `VAPID_SUBJECT` must be an `https:` or `mailto:` URI the deployer controls (e.g. a project contact address or the deployed domain) and that the two `VAPID_PUBLIC_KEY`/`NEXT_PUBLIC_VAPID_PUBLIC_KEY` values must be identical (server and client need the same public key; the `NEXT_PUBLIC_` copy is the one the browser bundle can read).
**Where**: `.env.example`
**Depends on**: None
**Reuses**: The file's existing commented-section style
**Requirement**: NOTIF-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] All four env vars are documented with a comment explaining their purpose and how to generate them (`npx web-push generate-vapid-keys`)
- [ ] No real key material is committed - placeholders only

**Tests**: none
**Gate**: build

**Commit**: `docs(env): document VAPID push notification environment variables`

---

### T19: Document the VAPID deployment steps

**What**: Extend `DEPLOYMENT.md` with a section covering: generating a VAPID key pair, setting the four env vars from T18 as Vercel project env vars, and a note that `public/sw.js` is served automatically as a static asset (no build step required).
**Where**: `DEPLOYMENT.md`
**Depends on**: T18
**Reuses**: The existing document's structure/tone (this file already documents the Upstash Redis setup step, following the same pattern)
**Requirement**: NOTIF-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A deployer following the doc top-to-bottom can generate keys, set them on Vercel, and understand why no extra build config is needed for the service worker

**Tests**: none
**Gate**: build

**Commit**: `docs(deployment): add VAPID push notification setup steps`

---

### T20: Add the service worker

**What**: Create `public/sw.js`: a `push` event listener that parses the JSON payload, calls `self.clients.matchAll({ type: "window", includeUncontrolled: true })`, and either `postMessage`s the payload to every focused client (suppressing the OS notification) or calls `self.registration.showNotification(title, { body, tag: scenario })` when no client is focused; a `notificationclick` listener that closes the notification and focuses an existing client or opens a new one.
**Where**: `public/sw.js`
**Depends on**: None
**Reuses**: Nothing (new, plain static JS, no bundler)
**Requirement**: NOTIF-02, NOTIF-03, NOTIF-15, NOTIF-23

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] File is valid JavaScript (no syntax errors - verified by loading it in a browser's Application → Service Workers panel during manual verification)
- [ ] Manually verified in a running `next dev` session (with a locally-sent test push, e.g. via a scratch script using `web-push`): focused tab → no OS notification appears, `message` event fires on the page; unfocused/backgrounded tab → OS notification appears
- [ ] Manually verified that clicking the OS notification focuses/opens the app

**Tests**: none
**Gate**: build

**Commit**: `feat(sw): add push-handling service worker with focus-aware channel suppression`

---

### T21: Add the browser-side push subscription helper

**What**: Create `lib/notifications/client.ts` exporting `requestPushSubscription(): Promise<PushSubscriptionRecord | null>` - feature-detects `serviceWorker`/`PushManager`/`Notification` (returns `null` immediately if any is absent), registers `/sw.js`, requests `Notification.requestPermission()`, returns `null` if not `"granted"`, otherwise calls `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <base64url-decoded NEXT_PUBLIC_VAPID_PUBLIC_KEY> })` and returns the subscription's `toJSON()` shape cast to `PushSubscriptionRecord`. Includes the standard `urlBase64ToUint8Array` helper (well-known snippet from the Push API ecosystem, not invented).
**Where**: `lib/notifications/client.ts`
**Depends on**: T20, T6
**Reuses**: Nothing existing to reuse - this is genuinely new browser-API surface
**Requirement**: NOTIF-03, NOTIF-28

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Returns `null` (never throws) when `PushManager`/`Notification`/`serviceWorker` is unsupported (mocked absent in test)
- [ ] Returns `null` when permission is denied (mocked `"denied"`)
- [ ] Returns a `PushSubscriptionRecord`-shaped object on the granted/success path (mocked `pushManager.subscribe`)
- [ ] Returns `null` when `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is unset
- [ ] Gate check passes: `npm run test:unit`
- [ ] Test count: 4 new test cases minimum

**Tests**: unit
**Gate**: quick

**Commit**: `feat(notifications): add browser push subscription helper`

---

### T22: Extend useQueue with subscription-aware join and error codes

**What**: In `hooks/useQueue.ts`: add `code?: string` to `QueueActionError`, populated in `callQueueApi` from the response body's `code` field when present; change `join`'s signature to `join(name: string, subscription?: PushSubscriptionRecord)`, forwarding `subscription` in the POST body only when provided.
**Where**: `hooks/useQueue.ts`
**Depends on**: T6
**Reuses**: `callQueueApi`'s existing error-parsing - only the parsed fields grow
**Requirement**: NOTIF-19, NOTIF-20, NOTIF-27

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A `409` response with `{error, code: "QUEUE_FULL"}` produces a `QueueActionError` with `.code === "QUEUE_FULL"`
- [ ] A `409` response with no `code` field produces a `QueueActionError` with `.code === undefined` (existing duplicate-name behavior unaffected)
- [ ] `join("Ana")` (no subscription) sends a body without a `subscription` field, exactly matching current behavior
- [ ] `join("Ana", subscription)` sends a body including `subscription`
- [ ] Existing `useQueue.test.ts` suite passes unmodified in its existing assertions
- [ ] Gate check passes: `npm run test:unit`
- [ ] Test count: existing suite + 4 new cases minimum

**Tests**: unit
**Gate**: quick

**Commit**: `feat(use-queue): surface error codes and accept an optional push subscription on join`

---

### T23: Add waitlist identity persistence

**What**: Create `lib/waitlist-identity.ts` mirroring `lib/identity.ts`'s shape: `getWaitlistIdentity(): { id: string; token: string } | null`, `setWaitlistIdentity(reg)`, `clearWaitlistIdentity()`, using its own `localStorage` key (distinct from `marmiflix.identity`) and its own type guard.
**Where**: `lib/waitlist-identity.ts`
**Depends on**: None
**Reuses**: The exact try/catch-around-`window.localStorage` structure of `lib/identity.ts`
**Requirement**: NOTIF-25, NOTIF-26

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Round-trips `{id, token}` through `localStorage` correctly
- [ ] Returns `null` on missing/corrupt/malformed stored data (never throws)
- [ ] `clearWaitlistIdentity()` removes the key
- [ ] Gate check passes: `npm run test:unit`
- [ ] Test count: matches `identity.test.ts`'s existing case count for the equivalent behaviors (minimum 5)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(waitlist): add localStorage persistence for waitlist registrations`

---

### T24: Add the QueueFull screen

**What**: Create `components/queue/QueueFull.tsx`: shows the "queue is full" message, an opt-in button ("Avisar quando abrir uma vaga") that calls `requestPushSubscription()` then `POST /api/queue/waitlist/join`, stores the result via `setWaitlistIdentity`, and flips to a "you'll be notified" confirmed state with a cancel action (`POST /api/queue/waitlist/leave` + `clearWaitlistIdentity`); while mounted with an active registration, listens for `navigator.serviceWorker.addEventListener("message", ...)` and calls `playTurnChime()` + `navigator.vibrate(200)` (WHERE supported) when `event.data.scenario === "seat-opened"`.
**Where**: `components/queue/QueueFull.tsx`
**Depends on**: T21, T23, T16, T17
**Reuses**: `playTurnChime` (`lib/sound.ts`), the visual language (`bg-char-800`, `rounded-3xl`, ember/amber gradient button) of `ErrorScreen.tsx`/`Landing.tsx`
**Requirement**: NOTIF-20, NOTIF-21, NOTIF-23

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Renders the queue-full message and opt-in control on mount with no existing registration
- [ ] After a successful opt-in, renders the "you'll be notified" state and persists the registration via `lib/waitlist-identity.ts`
- [ ] Cancel calls `waitlist/leave` and returns to the opt-in state
- [ ] No TypeScript errors: `npm run typecheck`
- [ ] Manually verified in a running `next dev` session: fill the queue to 100 (or lower `MAX_QUEUE_SEATS` locally for the manual check), confirm the screen appears, opt in, free a seat, confirm the focused-tab chime/vibration fires via the SW `message` event

**Tests**: none
**Gate**: quick

**Commit**: `feat(queue-full): add queue-full screen with seat-opened waitlist opt-in`

---

### T25: Wire the join-form opt-in checkbox and the QueueFull fallback into Landing

**What**: In `components/queue/Landing.tsx`: add an unchecked-by-default checkbox ("Avisar mesmo se eu fechar a aba"); on submit, if checked, call `requestPushSubscription()` and pass the result (if any) to `queue.actions.join(trimmedName, subscription)`; catch a `QueueActionError` with `.code === "QUEUE_FULL"` and render `<QueueFull onLeaveWaitlist={...} />` in place of the join form (local component state, not a `PhaseRouter` case - see design.md's note on why).
**Where**: `components/queue/Landing.tsx`
**Depends on**: T21, T22, T24, T11
**Reuses**: The existing `handleJoin`/`error` state shape - extended, not replaced
**Requirement**: NOTIF-19, NOTIF-20, NOTIF-27, NOTIF-28, NOTIF-29

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Checkbox is present, unchecked by default, and its label matches the copy agreed in `context.md`
- [ ] Checking it and submitting calls `requestPushSubscription()` before/alongside the join call
- [ ] Denying the permission prompt still completes the join successfully (subscription omitted)
- [ ] A `QUEUE_FULL`-coded rejection swaps the rendered form for `QueueFull`, with no other error path affected (duplicate-name and validation errors still show the existing inline message)
- [ ] No TypeScript errors: `npm run typecheck`
- [ ] Manually verified in a running `next dev` session: join with the box unchecked (no permission prompt appears), join with it checked (prompt appears at submit time), and a full-queue join attempt (renders `QueueFull`)

**Tests**: none
**Gate**: quick

**Commit**: `feat(landing): add notification opt-in and route full-queue joins to QueueFull`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6

Phase 1:  T1 → T2 → T5
          T1 → T3
          T1 → T4
Phase 2:  T6 → T7 → T8
          T6 → T9
Phase 3:  T10, T11, T12, T13, T14 (independent - each wires one existing route, all depend on Phase 2's T9)
Phase 4:  T16 → T17
          T18 → T19
          T15 (depends on Phase 1's T4)
Phase 5:  T20 → T21
Phase 6:  T23 → T24 → T25
          T22 → T25
```

Execution is strictly sequential - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order. Within Phase 3, tasks have no dependencies on each other (each independently wires one existing route to the new `withQueueMutation` return shape and `after()`), so their listed order (T10-T14) is execution convenience, not a dependency chain.

**How phase-based execution works:** see the `tlc-spec-driven` skill's Sub-Agent Delegation section. 25 tasks total → packs into ~3-4 batches of whole phases at the ~7-task budget (e.g. Phase 1+2 = 9 tasks, Phase 3+4 = 10 tasks, Phase 5+6 = 7 tasks is one reasonable cut; the orchestrator decides the exact cut at Execute time). This exceeds the ~8-task single-batch threshold, so sub-agent delegation will be offered before Execute begins.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Extend queue types | 1 file, types only | ✅ Granular |
| T2: Widen windows + seat cap + join subscription | 1 file, 1 function + constants | ✅ Granular |
| T3: Heating checkpoints | 1 file, 1 function | ✅ Granular |
| T4: Attach/prune subscriptions | 1 file, 2 related functions | ⚠️ OK - cohesive (both are the entry/subscription lifecycle counterpart to T1's types) |
| T5: Sync urgency constant | 1 file, 1 constant swap | ✅ Granular |
| T6: Notification types | 1 file, types only | ✅ Granular |
| T7: Strategy registry | 1 file, 1 function | ✅ Granular |
| T8: Dispatcher | 1 file, 2 related functions | ⚠️ OK - `dispatchAll` is a thin wrapper over `dispatchNotificationJob`, same concern |
| T9: Store wiring | 1 file, 1 function's internals | ✅ Granular |
| T10-T14: Route wiring ×5 | 1 file each | ✅ Granular (split per file, not batched) |
| T15-T17: New endpoints ×3 | 1 file each | ✅ Granular |
| T18-T19: Docs ×2 | 1 file each | ✅ Granular |
| T20: Service worker | 1 file | ✅ Granular |
| T21: Client push helper | 1 file, 1 function + 1 well-known helper | ✅ Granular |
| T22: useQueue extension | 1 file | ✅ Granular |
| T23: Waitlist identity | 1 file | ✅ Granular |
| T24: QueueFull component | 1 file | ✅ Granular |
| T25: Landing wiring | 1 file | ✅ Granular |

No task spans multiple files. No further splitting needed.

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T2 | T1 | T1 → T2 (Phase 1 block) | ✅ Match |
| T3 | T1 | T1 → T3 (Phase 1 block) | ✅ Match |
| T4 | T1 | T1 → T4 (Phase 1 block) | ✅ Match |
| T5 | T2 | T2 → T5 (Phase 1 block) | ✅ Match |
| T6 | T1 | T1 → T6 (Cross-Phase block) | ✅ Match |
| T7 | T6 | T6 → T7 (Phase 2 block) | ✅ Match |
| T8 | T7 | T7 → T8 (Phase 2 block) | ✅ Match |
| T9 | T3, T4, T6 | T3 → T9, T4 → T9 (Cross-Phase block), T6 → T9 (Phase 2 block) | ✅ Match |
| T10 | T9 | T9 → T10 (Cross-Phase block) | ✅ Match |
| T11 | T9, T2 | T9 → T11, T2 → T11 (Cross-Phase block) | ✅ Match |
| T12 | T9 | T9 → T12 (Cross-Phase block) | ✅ Match |
| T13 | T9 | T9 → T13 (Cross-Phase block) | ✅ Match |
| T14 | T9 | T9 → T14 (Cross-Phase block) | ✅ Match |
| T15 | T4 | T4 → T15 (Cross-Phase block) | ✅ Match |
| T16 | T1 | T1 → T16 (Cross-Phase block) | ✅ Match |
| T17 | T16 | T16 → T17 (Phase 4 block) | ✅ Match |
| T18 | none | (no arrow) | ✅ Match |
| T19 | T18 | T18 → T19 (Phase 4 block) | ✅ Match |
| T21 | T20, T6 | T20 → T21 (Phase 5 block), T6 → T21 (Cross-Phase block) | ✅ Match |
| T22 | T6 | T6 → T22 (Cross-Phase block) | ✅ Match |
| T24 | T21, T23, T16, T17 | T23 → T24 (Phase 6 block), T21 → T24, T16 → T24, T17 → T24 (Cross-Phase block) | ✅ Match |
| T25 | T21, T22, T24, T11 | T22 → T25, T24 → T25 (Phase 6 block), T21 → T25, T11 → T25 (Cross-Phase block) | ✅ Match |

Every `Depends on` edge across the whole task set - intra-phase and cross-phase alike - has a matching diagram arrow, either in its phase's block or the Cross-Phase Dependency Edges block. `python3 validate_tasks.py` confirms this deterministically (0 errors).

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Entity/type | none | none | ✅ OK |
| T2 | Domain logic | unit | unit | ✅ OK |
| T3 | Domain logic | unit | unit | ✅ OK |
| T4 | Domain logic | unit | unit | ✅ OK |
| T5 | UI component | none | none | ✅ OK |
| T6 | Entity/type | none | none | ✅ OK |
| T7 | Domain logic | unit | unit | ✅ OK |
| T8 | Domain logic | unit | unit | ✅ OK |
| T9 | CAS orchestration | integration | integration | ✅ OK |
| T10 | Route handler | integration | integration | ✅ OK |
| T11 | Route handler | integration | integration | ✅ OK |
| T12 | Route handler | integration | integration | ✅ OK |
| T13 | Route handler | integration | integration | ✅ OK |
| T14 | Route handler | integration | integration | ✅ OK |
| T15 | Route handler | integration | integration | ✅ OK |
| T16 | Route handler | integration | integration | ✅ OK |
| T17 | Route handler | integration | integration | ✅ OK |
| T18 | Config/docs | none | none | ✅ OK |
| T19 | Config/docs | none | none | ✅ OK |
| T20 | Service worker | none (flagged gap) | none | ✅ OK |
| T21 | Browser helper | unit | unit | ✅ OK |
| T22 | Browser helper | unit | unit | ✅ OK |
| T23 | Browser helper | unit | unit | ✅ OK |
| T24 | UI component | none | none | ✅ OK |
| T25 | UI component | none | none | ✅ OK |

No violations. Every `Tests: none` task maps to a matrix row that says `none`.

---

## Task Verification Standards

Every task's `Done when` entries are specific and binary pass/fail, each `Tests`/`Gate` pair traces to the matrix and gate commands above, and every unit/integration task states a minimum new-test-count to guard against silent deletions.
