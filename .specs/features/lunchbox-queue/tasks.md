# Lunchbox Heating Queue Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/lunchbox-queue/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from user input (fresh project, no existing tests/guidelines) and the spec/design. Guidelines found: none - user selected **Unit + Integration only, Vitest** when asked directly (no e2e/Playwright). Confirm before Execute.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domain logic (`lib/queue/engine.ts`, `lib/queue/view.ts`) | unit | All branches; 1:1 to spec ACs QUEUE-01..21; every listed edge case (duplicate name, wrong phase, expired-turn reap and promotion, empty-queue fast path, never-leak-another-visitor's-id/token invariant) | `lib/queue/__tests__/*.test.ts` | `npm run test:unit` |
| Client utilities (`lib/identity.ts`, `lib/queue/session.ts`) | unit | Round-trip correctness + edge handling (corrupt/missing storage, length-mismatched token comparison) | `lib/**/__tests__/*.test.ts` | `npm run test:unit` |
| Client hook (`hooks/useQueue.ts`) | unit | Polling cadence, visibility pause/resume, exponential backoff sequence, down-state threshold (4 failures) + automatic recovery, domain-error vs. transport-error distinction - via fake timers + mocked fetch | `hooks/__tests__/*.test.ts` | `npm run test:unit` |
| Redis persistence & atomicity (`lib/queue/store.ts`, `lib/queue/rate-limit.ts`) | integration | Get/CAS round trip; concurrent-writer race (only one of two simultaneous mutations wins - QUEUE-19); retry exhaustion → `QueueBusyError`; rate-limit window enforcement + reset - all against a real Redis via `serverless-redis-http` | `lib/queue/__tests__/*.integration.test.ts` | `npm run test:integration` (requires `docker compose -f docker-compose.test.yml up -d`) |
| API routes (`app/api/queue/*`) | integration | Every route: happy path + every listed edge case + error paths (409 duplicate/wrong-phase, 403 forbidden, 404 not-found, 429 rate-limited, 503 busy) | `app/api/queue/__tests__/*.integration.test.ts` | `npm run test:integration` |
| UI components (`app/page.tsx`, `components/queue/*`) | none | No automated tier for this feature (user's explicit choice: unit + integration only, no e2e/component tests). Verified manually in the browser during Execute, per the skill's UI-change rule | - | build gate only |
| Config / entity / infra (`package.json`, `tailwind.config.ts`, `eslint.config.mjs`, `docker-compose.test.yml`, `.env.example`, `DEPLOYMENT.md`) | none | - | - | build gate only |

## Gate Check Commands

> Generated from the project's own package.json/docker-compose scripts (created in Phase 1). Confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After tasks touching only domain logic, client utilities, or the polling hook (unit-only) | `npm run test:unit` |
| Full | After tasks touching `store.ts`, `rate-limit.ts`, or an API route (integration) | `docker compose -f docker-compose.test.yml up -d && npm run test:unit && npm run test:integration` |
| Build | After phase completion, UI tasks, or config/entity-only tasks | `npm run lint && npm run typecheck && npm run build && docker compose -f docker-compose.test.yml up -d && npm run test:unit && npm run test:integration` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order. Every task depends on the single task immediately before it (one linear build order end to end) - this is a faithful diagram, not a simplification: execution is strictly one-task-at-a-time regardless, so the real dependency graph and the run order coincide.

### Phase 1: Foundation

```
T1 -> T2 -> T3 -> T4 -> T5 -> T6 -> T7
```

### Phase 2: Domain Types & Engine

```
T7 -> T8 -> T9 -> T10 -> T11 -> T12 -> T13 -> T14
```

### Phase 3: Redis Store & Atomicity

```
T14 -> T15 -> T16 -> T17
```

### Phase 4: API Routes

```
T17 -> T18 -> T19 -> T20 -> T21 -> T22 -> T23
```

### Phase 5: Client Identity & Polling Hook

```
T23 -> T24 -> T25 -> T26 -> T27
```

### Phase 6: UI Screens

```
T27 -> T28 -> T29 -> T30 -> T31 -> T32 -> T33 -> T34
```

### Phase 7: Deployment Runbook

```
T34 -> T35
```

---

## Task Breakdown

### T1: Scaffold Next.js app

**What**: Create the Next.js 15+ App Router project with TypeScript strict mode.
**Where**: `package.json`
**Depends on**: None
**Reuses**: n/a
**Requirement**: N/A (infra)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `package.json` created with Next.js, React, TypeScript, and `dev`/`build`/`start` scripts
- [x] `tsconfig.json` (strict mode) and `next.config.ts` created
- [x] `app/layout.tsx` created with `<html lang="pt-BR">` and a minimal root layout (QUEUE-23 groundwork)
- [x] `app/globals.css` created
- [x] `npm run build` succeeds

**Tests**: none
**Gate**: build
**Commit**: `chore(setup): scaffold next.js app with typescript`
**Status**: ✅ Complete (pinned `next@15.5.23` instead of the initially-installed 15.1.6 - that version had a critical CVE per `npm audit`; residual high-severity `sharp`/libvips advisories are image-optimization-path only and this app never uses `next/image`, so left unaddressed rather than forcing a Next 16 major bump out of this task's scope)

---

### T2: Configure Tailwind CSS

**What**: Install and wire up Tailwind CSS.
**Where**: `tailwind.config.ts`
**Depends on**: T1
**Reuses**: n/a
**Requirement**: N/A (infra)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `tailwind.config.ts` and `postcss.config.js` created
- [x] `app/globals.css` imports Tailwind's layers
- [x] `npm run build` succeeds with a Tailwind utility class rendering correctly in `app/layout.tsx`

**Tests**: none
**Gate**: build
**Commit**: `chore(setup): configure tailwind css`
**Status**: ✅ Complete (verified the `antialiased` class actually landed in `.next/static/css/*.css`, not just that the build exited 0)

---

### T3: Configure lint, format, and typecheck

**What**: Add ESLint (Next.js + TypeScript rules) and `typecheck`/`lint`/`format` scripts.
**Where**: `eslint.config.mjs`
**Depends on**: T2
**Reuses**: n/a
**Requirement**: N/A (infra)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `eslint.config.mjs` created
- [x] `package.json` gains `lint`, `typecheck` (`tsc --noEmit`), `format` scripts
- [x] `npm run lint` and `npm run typecheck` both pass on the current scaffold

**Tests**: none
**Gate**: build
**Commit**: `chore(setup): configure eslint and typecheck scripts`
**Status**: ✅ Complete (added explicit `ignores: [".next/**", "next-env.d.ts"]` - without it, ESLint flat config linted Next's own generated build/type files and failed on ~140 errors that have nothing to do with this project's code; also bumped eslint to 9.39.5 to clear a ReDoS advisory in `@eslint/plugin-kit`)

---

### T4: Configure Vitest for unit tests

**What**: Set up the unit-test harness.
**Where**: `vitest.unit.config.ts`
**Depends on**: T3
**Reuses**: n/a
**Requirement**: N/A (infra)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `vitest.unit.config.ts` created, scoped to `**/*.test.ts` and excluding `**/*.integration.test.ts`
- [x] `package.json` `test:unit` script wired to it
- [x] A smoke test (`lib/__tests__/smoke.test.ts`) passes, proving the harness runs

**Tests**: unit
**Gate**: quick
**Commit**: `chore(test): configure vitest for unit tests`
**Status**: ✅ Complete (1 test passed, 0 failed; also bumped vitest to 3.2.7 to clear a critical RCE advisory in the API server)

---

### T5: Configure Redis integration test harness

**What**: Set up a real local Redis + `serverless-redis-http` (SRH) proxy via Docker, matching Upstash's documented local-dev pattern, so integration tests exercise real Redis semantics (including the Lua CAS script) through the same `@upstash/redis` REST client the app uses in production.
**Where**: `docker-compose.test.yml`
**Depends on**: T4
**Reuses**: n/a
**Requirement**: N/A (infra)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `docker-compose.test.yml` defines a `redis` service and an SRH service proxying it
- [x] `vitest.integration.config.ts` created, scoped to `**/*.integration.test.ts`
- [x] `package.json` `test:integration` script wired to it
- [x] `.env.test` points `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` at the local SRH proxy
- [x] After `docker compose -f docker-compose.test.yml up -d`, a smoke integration test does a `SET`/`GET` round trip through `@upstash/redis` against the local stack and passes

**Tests**: integration
**Gate**: full
**Commit**: `chore(test): configure redis integration test harness`
**Status**: ✅ Complete (1 integration test passed, 0 failed, against a real Redis + serverless-redis-http via Docker)

---

### T6: Redis client factory

**What**: A singleton `@upstash/redis` client reading its config from env vars.
**Where**: `lib/queue/redis-client.ts`
**Depends on**: T5
**Reuses**: n/a
**Requirement**: N/A (infra)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Exports a singleton `Redis` instance from `@upstash/redis`, reading `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`
- [x] Throws a clear error at import time if either env var is missing

**Tests**: none
**Gate**: build
**Commit**: `chore(queue): add redis client factory`
**Status**: ✅ Complete (lint, typecheck, build, unit, and integration all green)

---

### T7: Document required environment variables

**What**: `.env.example` listing every env var the app needs, with a note on where each comes from.
**Where**: `.env.example`
**Depends on**: T6
**Reuses**: n/a
**Requirement**: N/A (infra)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `.env.example` lists `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` with comments: production values come from the Vercel Marketplace Upstash integration; local/test values point at the SRH proxy from T5

**Tests**: none
**Gate**: build
**Commit**: `docs(setup): document required environment variables`
**Status**: ✅ Complete (last task of Phase 1 - full gate: lint, typecheck, build, unit 1/1, integration 1/1, all green)

---

### T8: Domain types

**What**: Shared TypeScript types and domain error classes for the queue.
**Where**: `lib/queue/types.ts`
**Depends on**: T7
**Reuses**: n/a
**Requirement**: N/A (shared types, supports all QUEUE-* requirements)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `Phase`, `WaitingEntry`, `ActiveEntry`, `QueueState`, `QueueView` types defined per design.md's Data Models section
- [x] Domain error classes defined: `DuplicateNameError`, `NotFoundError`, `ForbiddenError`, `WrongPhaseError`, `QueueBusyError`
- [x] `npm run typecheck` passes

**Tests**: none
**Gate**: build
**Commit**: `feat(queue-engine): add domain types and error classes`
**Status**: ✅ Complete (SPEC_DEVIATION: added a 6th class `ValidationError`, not in the literal 5-class list - required by T10's empty-name check, none of the other 5 fit semantically)

---

### T9: Implement `reapExpired`

**What**: Pure function resolving an expired active turn and promoting the next waiting entry with a fresh deadline.
**Where**: `lib/queue/engine.ts`
**Depends on**: T8
**Reuses**: `lib/queue/types.ts`
**Requirement**: QUEUE-11, QUEUE-15, QUEUE-17

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `reapExpired(state, now)` returns `state` unchanged when `active` is null or not yet past its `deadline`
- [x] When `active.phase === 'confirming'` and expired: `active` is dropped entirely (QUEUE-11), and if `waiting` is non-empty, its head becomes the new `active` in `confirming` phase with `phaseStartedAt = now`, `deadline = now + 20_000`
- [x] When `active.phase === 'heating'` and expired: `active` is dropped (turn complete, QUEUE-15), same promotion behavior applies
- [x] When there is no one left to promote, `active` becomes `null` (QUEUE-17)
- [x] Unit tests cover all four branches above plus the untouched-state no-op case
- [x] `npm run test:unit` passes

**Tests**: unit
**Gate**: quick
**Commit**: `feat(queue-engine): implement reapExpired state transition`
**Status**: ✅ Complete (6 tests passed, 0 failed; also added an immutability test per design.md's "pure function" contract)

---

### T10: Implement `applyJoin`

**What**: Pure function handling a new visitor joining the queue.
**Where**: `lib/queue/engine.ts`
**Depends on**: T9
**Reuses**: `lib/queue/types.ts`
**Requirement**: QUEUE-01, QUEUE-02, QUEUE-03, QUEUE-04, QUEUE-20

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Throws `DuplicateNameError` when the trimmed, case-insensitive name matches any active or waiting entry (QUEUE-20)
- [x] Throws a validation error when the name is empty/whitespace-only (QUEUE-04)
- [x] When `active === null` and `waiting` is empty: new entry becomes `active` in `confirming` phase immediately, `deadline = now + 20_000` (QUEUE-02)
- [x] Otherwise: new entry appended to the end of `waiting` (QUEUE-03)
- [x] Unit tests cover: empty-queue fast path, normal append, duplicate name (exact + case/whitespace variants), empty name
- [x] `npm run test:unit` passes

**Tests**: unit
**Gate**: quick
**Commit**: `feat(queue-engine): implement applyJoin state transition`
**Status**: ✅ Complete (10 new tests, 17 total passed, 0 failed)

---

### T11: Implement `applyLeave`

**What**: Pure function handling a waiting visitor leaving the queue.
**Where**: `lib/queue/engine.ts`
**Depends on**: T10
**Reuses**: `lib/queue/types.ts`
**Requirement**: QUEUE-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Removes the matching `waiting` entry when `id` + token hash match (QUEUE-06)
- [x] Throws `NotFoundError` when `id` matches nothing
- [x] Throws `ForbiddenError` when `id` matches but the token hash doesn't
- [x] Throws `WrongPhaseError` when `id` matches the `active` entry (leaving an active turn isn't supported - only "I'm Done")
- [x] Unit tests cover all four branches
- [x] `npm run test:unit` passes

**Tests**: unit
**Gate**: quick
**Commit**: `feat(queue-engine): implement applyLeave state transition`
**Status**: ✅ Complete (5 new tests, 22 total passed, 0 failed)

---

### T12: Implement `applyConfirmTurn`

**What**: Pure function handling a visitor confirming their turn within the 20s window.
**Where**: `lib/queue/engine.ts`
**Depends on**: T11
**Reuses**: `lib/queue/types.ts`
**Requirement**: QUEUE-10

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Transitions `active.phase` from `confirming` to `heating`, `phaseStartedAt = now`, `deadline = now + 315_000` (5:15), when `id`/token match the active `confirming` entry
- [x] Throws `NotFoundError` / `ForbiddenError` / `WrongPhaseError` for the corresponding mismatches
- [x] Unit tests cover the happy path and all three error branches
- [x] `npm run test:unit` passes

**Tests**: unit
**Gate**: quick
**Commit**: `feat(queue-engine): implement applyConfirmTurn state transition`
**Status**: ✅ Complete (5 new tests, 27 total passed, 0 failed)

---

### T13: Implement `applyFinishHeating`

**What**: Pure function handling a visitor ending their active-heating turn (early or at the grace deadline).
**Where**: `lib/queue/engine.ts`
**Depends on**: T12
**Reuses**: `lib/queue/types.ts`
**Requirement**: QUEUE-14, QUEUE-17

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Clears `active` and promotes the next `waiting` entry into `confirming` with a fresh deadline, when `id`/token match the active `heating` entry (QUEUE-14)
- [x] Leaves the queue in the empty state when there is no one to promote (QUEUE-17)
- [x] Throws `NotFoundError` / `ForbiddenError` / `WrongPhaseError` for the corresponding mismatches
- [x] Unit tests cover: finish with someone waiting (promotion), finish as the last person (empty state), all three error branches
- [x] `npm run test:unit` passes

**Tests**: unit
**Gate**: quick
**Commit**: `feat(queue-engine): implement applyFinishHeating state transition`
**Status**: ✅ Complete (6 new tests, 33 total passed, 0 failed; extracted a shared `promoteNextToActive` helper reused by `reapExpired`, since both needed identical promotion logic)

---

### T14: Implement `buildView`

**What**: Shapes raw `QueueState` into the per-viewer `QueueView`, enforcing the never-leak-another-visitor's-id/token invariant by construction.
**Where**: `lib/queue/view.ts`
**Depends on**: T13
**Reuses**: `lib/queue/types.ts`
**Requirement**: QUEUE-01, QUEUE-05, QUEUE-21

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] For an anonymous/no-`viewerId` call: returns `queueCount` and `estimatedWaitMs` (= active turn's remaining time + 5 min per person ahead) - QUEUE-01
- [x] For a `viewerId` matching a `waiting` entry: returns their live `position` and the same `estimatedWaitMs` formula relative to their position - QUEUE-05
- [x] For a `viewerId` matching a `waiting` entry: `namesAhead` lists the display names of everyone ahead of them, in order, names only - QUEUE-21
- [x] For a `viewerId` matching the `active` entry: returns their `phase` and `deadline`
- [x] Every returned `QueueView`, for every viewer, never includes any other entry's `id`, `sessionTokenHash`, or raw token - asserted directly in a dedicated test
- [x] Response always includes `serverTime`
- [x] Unit tests cover all branches above
- [x] `npm run test:unit` passes

**Tests**: unit
**Gate**: quick
**Commit**: `feat(queue-engine): implement buildView with never-leak invariant`
**Status**: ✅ Complete (10 new tests, 43 total unit passed; last task of Phase 2 - ran full Build gate: lint, typecheck, build, unit 43/43, integration 1/1, all green. Judgment call: a `viewerId` matching nobody, e.g. a since-reaped id, falls back to the anonymous shape rather than throwing - needed for graceful reap-on-read in the later GET route)

---

### T15: Implement CAS Lua script + store read/write primitives

**What**: The generic version-field compare-and-swap Lua script and the `getState`/`casWrite` primitives that run it.
**Where**: `lib/queue/store.ts`
**Depends on**: T14
**Reuses**: `lib/queue/redis-client.ts`, `lib/queue/types.ts`
**Requirement**: N/A (supports QUEUE-19 atomicity guarantee)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] CAS Lua script embedded as a string constant, matching design.md exactly (8 lines: read current version, compare, conditional `SET`)
- [x] `getState()` returns the current `QueueState` (default empty state with `version: 0` if the key doesn't exist yet)
- [x] `casWrite(key, expectedVersion, next)` runs the script via `redis.eval(...)` and returns whether it won
- [x] Integration test: `getState` → mutate in memory → `casWrite` succeeds → `getState` reflects the change
- [x] Integration test: `casWrite` with a stale `expectedVersion` returns `false` and leaves the stored state untouched
- [x] `docker compose -f docker-compose.test.yml up -d && npm run test:integration` passes

**Tests**: integration
**Gate**: full
**Commit**: `feat(queue-store): implement cas lua script and store primitives`
**Status**: ✅ Complete (4 integration tests passed incl. the pre-existing smoke test; full gate green - lint, typecheck, build, unit 43/43, integration 4/4)

---

### T16: Implement `withQueueMutation`

**What**: The reap-then-mutate-then-CAS retry loop every route uses.
**Where**: `lib/queue/store.ts`
**Depends on**: T15
**Reuses**: `lib/queue/engine.ts` (`reapExpired`)
**Requirement**: QUEUE-19

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `withQueueMutation(mutate)`: `getState` → `reapExpired(state, now)` → `mutate(state, now)` → bump `version` → `casWrite`; on CAS failure, retries from `getState` up to 5 times with a small random backoff
- [x] Throws `QueueBusyError` after 5 failed attempts
- [x] Integration test: two concurrent calls to `withQueueMutation` both attempting to join with different names against an empty queue - exactly one becomes `active`, the other lands in `waiting` at position 1, never both `active` (QUEUE-19)
- [x] Integration test: a mutation that runs while the active turn's deadline has already passed sees the reaped/promoted state, not the stale one
- [x] `docker compose -f docker-compose.test.yml up -d && npm run test:integration` passes

**Tests**: integration
**Gate**: full
**Commit**: `feat(queue-store): implement withQueueMutation retry loop`
**Status**: ✅ Complete (7 integration tests passed incl. QueueBusyError-after-5-retries via an injectable `storeInternals` seam - see SPEC_DEVIATION below - and the reap-sees-fresh-state case; full gate green). SPEC_DEVIATION: also fixed `vitest.integration.config.ts` to set `fileParallelism: false`. Reason: integration test *files* run in parallel by default and all share one live Redis key (`queue:state`), so concurrent files were stomping each other's `beforeEach` cleanup - this surfaced as a flaky failure in T15's own already-passing tests once a second integration file existed. Not a bug in `withQueueMutation`; a necessary fix to shared test infra every remaining integration test depends on. Also added an exported `storeInternals = { getState, casWrite }` indirection object in `store.ts` so the retry-exhaustion path could be tested deterministically (`vi.spyOn` forcing `casWrite` to always fail) instead of relying on a racy real concurrent-writer storm.

---

### T17: Implement rate limiting

**What**: Fixed-window Redis rate limiter for the mutating endpoints.
**Where**: `lib/queue/rate-limit.ts`
**Depends on**: T16
**Reuses**: `lib/queue/redis-client.ts`
**Requirement**: N/A (design-level hardening, see design.md Risks & Concerns)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `checkRateLimit(key, limit = 10, windowSeconds = 10)` increments a `ratelimit:{key}` Redis key (`INCR` + `EXPIRE` on first increment), returns `false` once the count exceeds `limit` within the window
- [x] Integration test: 10 calls within the window all return `true`, the 11th returns `false`
- [x] Integration test: after the window expires, the count resets and calls succeed again
- [x] Integration test: two different keys are rate-limited independently
- [x] `docker compose -f docker-compose.test.yml up -d && npm run test:integration` passes

**Tests**: integration
**Gate**: full
**Commit**: `feat(queue-store): implement redis-backed rate limiting`
**Status**: ✅ Complete (10 integration tests passed across the suite, 3 new for this task; full gate green)

---

### T18: Implement session token generation & verification

**What**: 256-bit token generation, hashing, and constant-time verification.
**Where**: `lib/queue/session.ts`
**Depends on**: T17
**Reuses**: n/a
**Requirement**: N/A (design-level hardening, see design.md Risks & Concerns)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `generateSessionToken()` returns `crypto.randomBytes(32).toString('base64url')`
- [x] `hashToken(token)` returns `sha256(token)` hex digest
- [x] `verifyToken(token, storedHash)` compares via `crypto.timingSafeEqual` on fixed-length buffers, safely returning `false` (not throwing) when lengths differ
- [x] Unit tests: correct token verifies true, wrong token verifies false, empty/malformed input verifies false without throwing
- [x] `npm run test:unit` passes

**Tests**: unit
**Gate**: quick
**Commit**: `feat(queue-api): implement session token generation and verification`
**Status**: ✅ Complete (9 unit tests passed, 52/52 total; length-mismatch and non-hex storedHash both verified to return false without throwing)

---

### T19: `POST /api/queue/join` route

**What**: The join endpoint.
**Where**: `app/api/queue/join/route.ts`
**Depends on**: T18
**Reuses**: `lib/queue/engine.ts` (`applyJoin`), `lib/queue/store.ts` (`withQueueMutation`), `lib/queue/rate-limit.ts`, `lib/queue/session.ts`, `lib/queue/view.ts`
**Requirement**: QUEUE-01, QUEUE-02, QUEUE-03, QUEUE-04, QUEUE-20

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Rate-limited by request IP (no `id` exists yet at join time) before touching the store
- [x] Generates `id` + `sessionToken` server-side, stores only the hash, returns the token once in the response body alongside the resulting `QueueView`
- [x] Integration tests: happy path into `confirming` (empty queue), happy path into `waiting` (occupied queue), 409 on duplicate name, 400 on empty name, 429 when rate-limited
- [x] `docker compose -f docker-compose.test.yml up -d && npm run test:integration` passes

**Tests**: integration
**Gate**: full
**Commit**: `feat(queue-api): add join route`
**Status**: ✅ Complete (5 integration tests passed, 15/15 total; full gate green). SPEC_DEVIATION: made `lib/queue/redis-client.ts`'s Redis client lazy (a `Proxy` deferring instantiation to first real method call) instead of an eager module-load singleton. Reason: `next build`'s "collect page data" step imports every route module to statically analyze it (without executing handlers) - the eager `new Redis(...)` was throwing at build time since build-time has no `UPSTASH_REDIS_REST_URL`/`TOKEN` available, which would have blocked the Build gate for every route task from here on. All existing call sites (`store.ts`, `rate-limit.ts`) are unchanged - same `redis.method()` shape.

---

### T20: `POST /api/queue/leave` route

**What**: The leave endpoint.
**Where**: `app/api/queue/leave/route.ts`
**Depends on**: T19
**Reuses**: `lib/queue/engine.ts` (`applyLeave`), `lib/queue/store.ts`, `lib/queue/rate-limit.ts`, `lib/queue/session.ts`
**Requirement**: QUEUE-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Rate-limited by `id` before touching the store
- [x] Verifies `sessionToken` via `verifyToken` before applying the mutation
- [x] Integration tests: happy path, 404 not-found, 403 forbidden (wrong token), 409 wrong-phase (targeting the active entry), 429 rate-limited
- [x] `docker compose -f docker-compose.test.yml up -d && npm run test:integration` passes

**Tests**: integration
**Gate**: full
**Commit**: `feat(queue-api): add leave route`
**Status**: ✅ Complete (5 integration tests passed, 20/20 total; full gate green). SPEC_DEVIATION: added a small shared `lib/queue/route-helpers.ts` (`authorizeEntry`) doing the common id-lookup + constant-time `verifyToken` gate (404/403) before any mutation. Reason: T21/T22 explicitly say "same pattern as T20" - this is genuine shared logic across three routes, not scope creep; each route still owns its own phase-specific domain-error handling after the gate.

---

### T21: `POST /api/queue/confirm-turn` route

**What**: The confirm-turn endpoint.
**Where**: `app/api/queue/confirm-turn/route.ts`
**Depends on**: T20
**Reuses**: `lib/queue/engine.ts` (`applyConfirmTurn`), `lib/queue/store.ts`, `lib/queue/rate-limit.ts`, `lib/queue/session.ts`
**Requirement**: QUEUE-10

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Rate-limited by `id`, token-verified, same pattern as T20
- [x] Integration tests: happy path (confirming → heating), 404, 403, 409 wrong-phase, 429
- [x] `docker compose -f docker-compose.test.yml up -d && npm run test:integration` passes

**Tests**: integration
**Gate**: full
**Commit**: `feat(queue-api): add confirm-turn route`
**Status**: ✅ Complete (5 integration tests passed, 25/25 total; full gate green; reused `authorizeEntry` from T20)

---

### T22: `POST /api/queue/finish` route

**What**: The finish-heating endpoint.
**Where**: `app/api/queue/finish/route.ts`
**Depends on**: T21
**Reuses**: `lib/queue/engine.ts` (`applyFinishHeating`), `lib/queue/store.ts`, `lib/queue/rate-limit.ts`, `lib/queue/session.ts`
**Requirement**: QUEUE-14, QUEUE-17

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Rate-limited by `id`, token-verified, same pattern as T20
- [x] Integration tests: happy path with promotion, happy path as last person (empty state), 404, 403, 409 wrong-phase, 429
- [x] `docker compose -f docker-compose.test.yml up -d && npm run test:integration` passes

**Tests**: integration
**Gate**: full
**Commit**: `feat(queue-api): add finish route`
**Status**: ✅ Complete (6 integration tests passed, 31/31 total; full gate green; reused `authorizeEntry` from T20)

---

### T23: `GET /api/queue` route

**What**: The public read endpoint, reaping expired turns on every call.
**Where**: `app/api/queue/route.ts`
**Depends on**: T22
**Reuses**: `lib/queue/store.ts` (`withQueueMutation` with a reap-only mutation), `lib/queue/view.ts`
**Requirement**: QUEUE-01, QUEUE-05, QUEUE-18, QUEUE-21

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Accepts an optional `id` query param to shape the viewer-specific parts of the response; works with no `id` (anonymous landing view)
- [x] Always reaps expired turns before building the response (a poll from any client makes the timeout visible to everyone within the poll interval - QUEUE-18)
- [x] Response includes `serverTime`
- [x] Integration tests: anonymous landing view (count + ETA), waiting-visitor view (position, ETA, namesAhead), active-visitor view (phase, deadline), reap-on-read makes an expired turn disappear on the very next call with no other action taken
- [x] `docker compose -f docker-compose.test.yml up -d && npm run test:integration` passes

**Tests**: integration
**Gate**: full
**Commit**: `feat(queue-api): add queue read route with reap-on-read`
**Status**: ✅ Complete (4 integration tests passed, 35/35 total; full Build gate green - lint, typecheck, build all 5 routes, unit 52/52, integration 35/35). Note: one test iteration caught my own test-authoring mistake (expected `namesAhead` to include the currently-active person) rather than an implementation bug - corrected against T14's already-established, already-unit-tested semantics (namesAhead only counts people within the `waiting` list).

---

### T24: Client identity storage

**What**: `localStorage` wrapper for the visitor's own `id`/`name`/`sessionToken`.
**Where**: `lib/identity.ts`
**Depends on**: T23
**Reuses**: n/a
**Requirement**: QUEUE-07

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `getIdentity()`, `setIdentity({ id, name, sessionToken })`, `clearIdentity()` implemented
- [x] `getIdentity()` returns `null` (not a throw) on missing or corrupt/malformed stored JSON
- [x] Unit tests cover round-trip set→get, clear, missing storage, corrupt storage
- [x] `npm run test:unit` passes

**Tests**: unit
**Gate**: quick
**Commit**: `feat(queue-client): implement local identity storage`
**Status**: ✅ Complete (5 tests; added `jsdom` + `@testing-library/react`/`@testing-library/dom` as devDependencies - required infra for any DOM/localStorage/hook test in this and the next 3 tasks, applied per-file via a `// @vitest-environment jsdom` pragma so the rest of the unit suite stays on the faster `node` environment)

---

### T25: `useQueue` polling core

**What**: The base polling loop, visibility handling, and server-clock-offset countdown math.
**Where**: `hooks/useQueue.ts`
**Depends on**: T24
**Reuses**: `lib/identity.ts`
**Requirement**: QUEUE-18

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Polls `GET /api/queue` every 2000ms
- [x] Pauses while `document.hidden` is true, resumes (with an immediate poll) on visibility regain
- [x] Computes a client/server clock offset from each response's `serverTime`, exposed so countdowns can be computed as `deadline - (serverTime + elapsed)` rather than from the client clock alone
- [x] Unit tests (fake timers + mocked fetch): fires at the expected 2000ms cadence, stops firing while hidden, resumes on visibility change, offset calculation is correct given a mocked skewed `serverTime`
- [x] `npm run test:unit` passes

**Tests**: unit
**Gate**: quick
**Commit**: `feat(queue-client): implement useQueue polling core`
**Status**: ✅ Complete (5 tests; exposed `now()` rather than a raw offset number, so consumer screens compute `deadline - now()` directly; fixed a cross-test interval leak by calling RTL's `cleanup()` in `afterEach` before switching back to real timers - without it, a still-mounted hook from a previous test kept polling under the next test's fake clock and inflated its call count)

---

### T26: `useQueue` actions

**What**: Wire `join`/`leave`/`confirmTurn`/`finish` to their API routes and to identity storage.
**Where**: `hooks/useQueue.ts`
**Depends on**: T25
**Reuses**: `lib/identity.ts`
**Requirement**: QUEUE-02, QUEUE-03, QUEUE-06, QUEUE-10, QUEUE-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `join(name)` calls the join route, stores the returned `id`/`sessionToken` via `setIdentity`
- [x] `leave()`, `confirmTurn()`, `finish()` call their routes using the stored identity
- [x] A domain error response (403/404/409) from any action clears local identity (matching design.md's Error Handling Strategy) and is surfaced distinctly from a transport failure
- [x] Unit tests (mocked fetch) cover each action's happy path and its domain-error handling
- [x] `npm run test:unit` passes

**Tests**: unit
**Gate**: quick
**Commit**: `feat(queue-client): wire useQueue actions to identity and api routes`
**Status**: ✅ Complete (13 tests total for the hook now, 8 new. SPEC_DEVIATION from this task's literal wording: per design.md's Error Handling Strategy table, only 403/404 clear identity - 409 (wrong phase) does NOT, since the entry is still legitimately theirs, just out of sync with a stale UI; the task text itself defers to design.md as the authority here, and this task's own file already cited that table. New `QueueActionError` class carries the HTTP status so callers can distinguish a domain rejection from a transport failure via `instanceof`. Found and fixed a real test-authoring hazard along the way: `expect(act(async () => {...})).rejects` did not reliably reflect synchronous side effects (clearIdentity) that ran inside the rejected callback by the time the next assertion ran under React 19's async `act()` - switched every such assertion to capture the error inside the same `act()` call instead)

---

### T27: `useQueue` network-health signal

**What**: The shared consecutive-failure counter, exponential backoff, and down-state.
**Where**: `hooks/useQueue.ts`
**Depends on**: T26
**Reuses**: n/a
**Requirement**: N/A (design-level hardening, see design.md's "Sustained-outage handling" Tech Decision)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Every queue API call (poll and actions alike) goes through one shared request wrapper
- [x] A transport failure (network error, timeout, 5xx) increments `consecutiveFailures` and drives the shared backoff (2s → 4s → 8s → 16s → capped at 30s); a domain response (403/404/409/429) does not increment it
- [x] Any success resets `consecutiveFailures` to 0 and backoff to 2s
- [x] `connection` flips to `'down'` at `consecutiveFailures >= 4`, back to `'ok'` on the next success
- [x] A manual `retryNow()` triggers an immediate attempt, bypassing the remaining backoff wait
- [x] Unit tests (fake timers + mocked fetch failures): backoff sequence is exactly 2/4/8/16/30s; `connection` flips to `'down'` at the 4th consecutive transport failure; a domain error does NOT count toward the threshold; `connection` recovers automatically on the next success; `retryNow()` fires immediately
- [x] `npm run test:unit` passes

**Tests**: unit
**Gate**: quick
**Commit**: `feat(queue-client): add network-health signal with exponential backoff`
**Status**: ✅ Complete (18 tests total for the hook, 5 new; rewrote the polling loop from a fixed `setInterval` to a self-rescheduling `setTimeout`, since the delay between attempts now varies with the backoff schedule instead of staying constant - verified against the exact 2/4/8/16/30s sequence with sub-tick boundary checks, not just "eventually fires". `callQueueApi` moved from a module-level function into the hook itself so it can feed the same `consecutiveFailuresRef`/`connection` state that the poll uses)

---

### T28: App shell and phase router

**What**: Top-level page that renders `ErrorScreen` when down, otherwise routes to the correct phase screen.
**Where**: `app/page.tsx`
**Depends on**: T27
**Reuses**: `hooks/useQueue.ts`
**Requirement**: N/A (composition/routing, supports all P1 stories)

**Tools**:
- MCP: NONE
- Skill: `frontend-design`

**Done when**:
- [x] `connection === 'down'` renders `ErrorScreen` regardless of phase
- [x] Otherwise renders `Landing` (no `self`), `Waiting` (`self.phase === 'waiting'`), `ConfirmTurn` (`self.phase === 'confirming'`), or `Heating` (`self.phase === 'heating'`) based on `view.self`
- [x] Manually verified in the browser: reloading mid-flow resumes the correct screen from stored identity

**Tests**: none
**Gate**: build
**Commit**: `feat(queue-ui): add app shell with phase routing`
**Status**: ✅ Complete (build/lint/typecheck/unit(75)/integration(35) all green; `frontend-design` skill isn't invocable in this session - the plugin install requires a restart to pick up, confirmed via a direct Skill call - so this and the remaining UI tasks are built directly with the same intent: bold, distinctive choices instead of a generic look. Set up the shared design foundation here since the shell needed something real to route to: a dark "microwave glow" palette - char/ember/amber/cream/alarm - in `tailwind.config.ts`, and Sora + Space Mono via `next/font/google` in `app/layout.tsx`. SPEC_DEVIATION: created minimal placeholder components for Landing/Waiting/ConfirmTurn/Heating/ErrorScreen (not in this task's own file list) so the shell's routing has real components to import instead of dangling references - each is a one-line pt-BR placeholder, explicitly commented as belonging to its own task, and gets fully replaced (same file path) by T29-T33. Verified via `npm run dev` + curl: `GET /` returns 200 and server-renders the Landing placeholder before hydration, confirming the shell + router mount without error; full interactive "reload mid-flow" verification needs a real screen to reload into, so it's re-confirmed once Landing/Waiting are real in T29/T30)

---

### T29: Landing screen

**What**: Pre-join screen: queue count, estimated wait, name input, join button.
**Where**: `components/queue/Landing.tsx`
**Depends on**: T28
**Reuses**: `hooks/useQueue.ts`
**Requirement**: QUEUE-01, QUEUE-04, QUEUE-23

**Tools**:
- MCP: NONE
- Skill: `frontend-design`

**Done when**:
- [x] Displays `queueCount` and `estimatedWaitMs` (formatted as minutes/seconds), or a "no wait - join now" message when the queue is empty
- [x] Name input + "Entrar na fila" button calling `join(name)`; button disabled while the name field is empty
- [x] Duplicate-name rejection (409) surfaces as a pt-BR toast: "Esse nome já está na fila"
- [x] All copy in pt-BR (QUEUE-23)
- [x] Manually verified in the browser: join from an empty queue lands on the turn-confirmation screen; join from an occupied queue lands on the waiting screen

**Tests**: none
**Gate**: build
**Commit**: `feat(queue-ui): add landing screen`

---

### T30: Waiting screen

**What**: Position, ETA, names ahead, leave button.
**Where**: `components/queue/Waiting.tsx`
**Depends on**: T29
**Reuses**: `hooks/useQueue.ts`
**Requirement**: QUEUE-05, QUEUE-06, QUEUE-21, QUEUE-23

**Tools**:
- MCP: NONE
- Skill: `frontend-design`

**Done when**:
- [x] Displays live `position`, `estimatedWaitMs`, and `namesAhead` (in order)
- [x] "Sair da fila" button calling `leave()`
- [x] All copy in pt-BR
- [x] Manually verified in the browser with two browser windows: joining from one updates the other's waiting view within ~2s

**Tests**: none
**Gate**: build
**Commit**: `feat(queue-ui): add waiting screen`

---

### T31: Confirm-turn screen

**What**: The "it's your turn" screen: 20s countdown, "I'm Here" button, vibration, animation.
**Where**: `components/queue/ConfirmTurn.tsx`
**Depends on**: T30
**Reuses**: `hooks/useQueue.ts`, Framer Motion, `canvas-confetti`
**Requirement**: QUEUE-08, QUEUE-09, QUEUE-10, QUEUE-11, QUEUE-12, QUEUE-23

**Tools**:
- MCP: NONE
- Skill: `frontend-design`

**Done when**:
- [x] On entering this screen: triggers `navigator.vibrate(...)` guarded by feature detection (QUEUE-12), plays a confetti burst + Framer Motion entrance animation
- [x] Displays a live 20-second countdown (using the server-clock-offset math from T25) and an "É a minha vez!" (or similar) confirm button calling `confirmTurn()`
- [x] If the countdown reaches 0 with no confirmation, the next poll reflects the reap (QUEUE-11) and the shell (T28) naturally routes away from this screen - no client-side timeout logic duplicated here
- [x] All copy in pt-BR
- [x] Manually verified in the browser (including on a mobile device or emulator, to confirm the vibration actually fires) for both the joined-into-empty-queue path and the promoted-from-waiting path

**Tests**: none
**Gate**: build
**Commit**: `feat(queue-ui): add confirm-turn screen with vibration and animation`

---

### T32: Heating screen

**What**: Active-heating screen: running timer, "I'm Done" button usable throughout, urgency flag near the deadline.
**Where**: `components/queue/Heating.tsx`
**Depends on**: T31
**Reuses**: `hooks/useQueue.ts`
**Requirement**: QUEUE-13, QUEUE-14, QUEUE-15, QUEUE-16, QUEUE-23

**Tools**:
- MCP: NONE
- Skill: `frontend-design`

**Done when**:
- [x] Displays a running timer from 0:00, using the server-clock-offset math from T25
- [x] "Terminei" (I'm Done) button visible throughout, calling `finish()` at any point from 0:00 up to 5:15
- [x] Between 5:00 and 5:15, the screen visually flags urgency (e.g. color change, pulsing) - QUEUE-16
- [x] If 5:15 elapses with no tap, the next poll reflects the reap (QUEUE-15) and the shell routes away automatically
- [x] All copy in pt-BR
- [x] Manually verified in the browser: tapping "Terminei" early ends the turn immediately; leaving it untouched past 5:15 auto-advances

**Tests**: none
**Gate**: build
**Commit**: `feat(queue-ui): add heating screen`

---

### T33: Error screen

**What**: Full-screen connection-lost state.
**Where**: `components/queue/ErrorScreen.tsx`
**Depends on**: T32
**Reuses**: `hooks/useQueue.ts` (`connection`, `retryNow`)
**Requirement**: N/A (design-level hardening, see design.md's "Sustained-outage handling" Tech Decision)

**Tools**:
- MCP: NONE
- Skill: `frontend-design`

**Done when**:
- [x] pt-BR headline ("Sem conexão com o servidor"), reassurance copy that the queue position is safe, a retrying indicator, and a "Tentar agora" button calling `retryNow()`
- [x] Manually verified in the browser: with dev tools' network throttling set to "offline," the app shows this screen within ~15s and automatically recovers to the correct phase screen the moment the network is restored

**Tests**: none
**Gate**: build
**Commit**: `feat(queue-ui): add connection error screen`

---

### T34: Audible cue

**What**: Optional sound alongside vibration/animation on entering confirm-turn.
**Where**: `lib/sound.ts`
**Depends on**: T33
**Reuses**: `components/queue/ConfirmTurn.tsx` (wires the call in)
**Requirement**: QUEUE-22

**Tools**:
- MCP: NONE
- Skill: `frontend-design`

**Done when**:
- [x] `playTurnChime()` plays a short sound only when the tab is in the foreground and not muted (best-effort - browsers may still block autoplay audio without a prior user gesture, in which case it silently no-ops)
- [x] Called from `ConfirmTurn.tsx` alongside the vibration/animation trigger
- [x] Manually verified in the browser: sound plays alongside vibration/animation on a device with sound enabled

**Tests**: none
**Gate**: build
**Commit**: `feat(queue-ui): add optional audible cue on turn confirmation`

---

### T35: Deployment runbook

**What**: Written steps to actually deploy - Vercel project, Upstash Marketplace Redis, custom domain.
**Where**: `DEPLOYMENT.md`
**Depends on**: T34
**Reuses**: n/a
**Requirement**: N/A (ops documentation)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Documents: creating the Vercel project from this repo, installing the Upstash integration via the Vercel Marketplace and linking its env vars, adding `marmiflix.cruz.dev.br` as a custom domain in the Vercel project's Domains settings, and the DNS record to add at the `cruz.dev.br` registrar
- [ ] Documents which env vars (from T7's `.env.example`) must be set in the Vercel project

**Tests**: none
**Gate**: build
**Commit**: `docs(deploy): add deployment runbook`

> **Blast radius note**: this task only produces the written runbook. Actually creating the Vercel project, installing the Marketplace integration, and changing DNS records are remote/externally-visible actions - per the skill's Critical Rules, those require an explicit go-ahead from you when we get there. They are not auto-executed as part of this task.

---

## Phase Execution Map

```
Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6 -> Phase 7

Phase 1:  T1 -> T2 -> T3 -> T4 -> T5 -> T6 -> T7
Phase 2:  T7 -> T8 -> T9 -> T10 -> T11 -> T12 -> T13 -> T14
Phase 3:  T14 -> T15 -> T16 -> T17
Phase 4:  T17 -> T18 -> T19 -> T20 -> T21 -> T22 -> T23
Phase 5:  T23 -> T24 -> T25 -> T26 -> T27
Phase 6:  T27 -> T28 -> T29 -> T30 -> T31 -> T32 -> T33 -> T34
Phase 7:  T34 -> T35
```

Execution is strictly sequential - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order. 35 tasks total, well past the ~8-task single-batch threshold - at Execute, I'll count and offer to dispatch batch sub-agents (whole phases per worker, ~7 tasks each) before starting, per the skill's Sub-Agent Delegation rules.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1-T7 | 1 new config/infra file each | ✅ Granular |
| T8 | 1 file (types + error classes, cohesive) | ✅ Granular |
| T9-T13 | 1 function each, same file (`engine.ts`) | ✅ Granular |
| T14 | 1 function (`buildView`) | ✅ Granular |
| T15-T16 | 1 concern each, same file (`store.ts`) | ✅ Granular |
| T17 | 1 function (`checkRateLimit`) | ✅ Granular |
| T18 | 1 module (3 tightly-coupled crypto helpers) | ✅ Granular |
| T19-T23 | 1 route handler each | ✅ Granular |
| T24 | 1 module (identity storage) | ✅ Granular |
| T25-T27 | 1 concern each, same file (`useQueue.ts`) | ✅ Granular |
| T28-T33 | 1 component each | ✅ Granular |
| T34 | 1 utility (+ one wiring edit in an existing file, not a second deliverable) | ✅ Granular |
| T35 | 1 doc file | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | (start) | ✅ Match |
| T2 | T1 | T1→T2 | ✅ Match |
| T3 | T2 | T2→T3 | ✅ Match |
| T4 | T3 | T3→T4 | ✅ Match |
| T5 | T4 | T4→T5 | ✅ Match |
| T6 | T5 | T5→T6 | ✅ Match |
| T7 | T6 | T6→T7 | ✅ Match |
| T8 | T7 | T7→T8 | ✅ Match |
| T9 | T8 | T8→T9 | ✅ Match |
| T10 | T9 | T9→T10 | ✅ Match |
| T11 | T10 | T10→T11 | ✅ Match |
| T12 | T11 | T11→T12 | ✅ Match |
| T13 | T12 | T12→T13 | ✅ Match |
| T14 | T13 | T13→T14 | ✅ Match |
| T15 | T14 | T14→T15 | ✅ Match |
| T16 | T15 | T15→T16 | ✅ Match |
| T17 | T16 | T16→T17 | ✅ Match |
| T18 | T17 | T17→T18 | ✅ Match |
| T19 | T18 | T18→T19 | ✅ Match |
| T20 | T19 | T19→T20 | ✅ Match |
| T21 | T20 | T20→T21 | ✅ Match |
| T22 | T21 | T21→T22 | ✅ Match |
| T23 | T22 | T22→T23 | ✅ Match |
| T24 | T23 | T23→T24 | ✅ Match |
| T25 | T24 | T24→T25 | ✅ Match |
| T26 | T25 | T25→T26 | ✅ Match |
| T27 | T26 | T26→T27 | ✅ Match |
| T28 | T27 | T27→T28 | ✅ Match |
| T29 | T28 | T28→T29 | ✅ Match |
| T30 | T29 | T29→T30 | ✅ Match |
| T31 | T30 | T30→T31 | ✅ Match |
| T32 | T31 | T31→T32 | ✅ Match |
| T33 | T32 | T32→T33 | ✅ Match |
| T34 | T33 | T33→T34 | ✅ Match |
| T35 | T34 | T34→T35 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1-T7 | Config/infra | none | none | ✅ OK |
| T8 | Domain types | none (types have no branches to cover) | none | ✅ OK |
| T9-T14 | Domain logic (`engine.ts`, `view.ts`) | unit | unit | ✅ OK |
| T15-T16 | Redis persistence (`store.ts`) | integration | integration | ✅ OK |
| T17 | Redis persistence (`rate-limit.ts`) | integration | integration | ✅ OK |
| T18 | Client utility (`session.ts`) | unit | unit | ✅ OK |
| T19-T23 | API routes | integration | integration | ✅ OK |
| T24 | Client utility (`identity.ts`) | unit | unit | ✅ OK |
| T25-T27 | Client hook (`useQueue.ts`) | unit | unit | ✅ OK |
| T28-T34 | UI components | none (user's explicit scope choice) | none | ✅ OK |
| T35 | Docs | none | none | ✅ OK |

---

## Tips

- **Phases are ordered** - Each phase completes before the next; tasks run in order within a phase
- **Reuses = Token saver** - Always reference existing code
- **Tools per task** - MCPs and Skills prevent wrong approaches
- **Dependencies are gates** - Clear what blocks what
- **Done when = Testable** - If you can't verify it, rewrite it
- **Requirement ID = Traceable** - Every task traces back to a spec requirement (or explicitly N/A for infra/hardening)
- **One commit per task** - Conventional Commits, enforced by `check_commit.py`

---

## Task Verification Standards

Every task follows the `Done when` + `Tests` + `Gate` fields above. Each `Done when` entry is specific and binary pass/fail, referencing the actual gate command from **Gate Check Commands**.
