# STATE

## Decisions

### AD-001
- **Decision**: marmiflix runs on Next.js (App Router, TypeScript) on Vercel, with a single Upstash Redis key (via the Vercel Marketplace integration) as the queue's data store, atomicity via a version-field compare-and-swap (tiny generic Lua script) rather than a full Lua state machine, and realtime sync via client polling (~2s, visibility-paused, exponential backoff) rather than websockets/push.
- **Reason**: Simplest stack that meets the spec's 3s realtime bound and handles serverless-safe deadline timeouts (lazy reap-on-read) without needing a persistent process or a cron job; keeps all business logic in unit-testable TypeScript instead of Lua.
- **Trade-off**: Not true push-based realtime (small polling delay, more request volume than websockets); single Redis key is a write-contention point under heavy concurrent load. Both are explicitly named as the first things to revisit (e.g. swap to Supabase Realtime) if usage ever outgrows this.
- **Scope**: Whole app (only feature so far: lunchbox-queue) - any future feature touching queue state or realtime sync must conform or explicitly supersede this.
- **Date**: 2026-08-18
- **Status**: active

### AD-002
- **Decision**: Out-of-tab attention (Web Push) is delivered via VAPID Web Push (`web-push` npm package, server-side only), with channel selection (OS push notification vs. in-tab sound/vibration) decided by the visitor's **service worker** at delivery time - via `clients.matchAll()` + `WindowClient.focused` - rather than by the server tracking focus state. Server-side event detection (heating-elapsed checkpoints, turn/seat-opened transitions) is piggybacked onto the existing lazy on-read `withQueueMutation` path (same pattern as `reapExpired`), not a new scheduler/cron. Background push delivery uses Next.js `after()` (`next/server`, stable since 15.1) called at the route-handler level, not raw fire-and-forget promises.
- **Reason**: Only the browser knows its own live focus state without staleness, so putting channel selection there avoids inventing a server-side heartbeat/presence channel. Event detection via the existing lazy on-read path conforms to `AD-001`'s no-cron/no-persistent-process constraint instead of introducing a new mechanism.
- **Trade-off**: Checkpoint/event timing precision is bounded by the polling interval (~2s), same class of imprecision `AD-001` already accepted for realtime sync - not a new risk, just applied to a second use case. `after()`'s request-scoped execution must be called from the route handler itself, not a deep helper, to reliably attach to the in-flight request.
- **Scope**: Whole app (feature: `queue-notifications`) - any future feature adding a new out-of-tab notification scenario should route through the existing `lib/notifications/` dispatch + strategy registry rather than building a parallel mechanism.
- **Date**: 2026-08-21
- **Status**: active

### AD-003
- **Decision**: All `process.env` reads in the app are centralized in `lib/queue/config.ts`, regardless of which feature or domain they belong to (queue timing, Redis connection, Web Push VAPID keys, the idle-standby timeout). Every export is a **function**, not a plain top-level const - `secondsFromEnv`/`secondsFromString` for numeric server config, one small `() => process.env.X` getter per raw string value (`upstashRedisRestUrl`, `upstashRedisRestToken`, `vapidSubject`, `vapidPublicKey`, `vapidPrivateKey`, `nextPublicVapidPublicKey`). The one exception to the function rule is `IDLE_TIMEOUT_MS`, a plain const - see its own inline comment for why a `NEXT_PUBLIC_` client var can't share `secondsFromEnv`'s dynamic `process.env[name]` lookup (Next.js only inlines a literal `process.env.NEXT_PUBLIC_X` expression into the client bundle).
- **Reason**: Requested directly, to stop `process.env.X` reads from being scattered across `redis-client.ts`, `dispatcher.ts`, and `client.ts`. The function-not-const requirement isn't stylistic - a plain const snapshots `process.env` once, at whichever moment the module first loads; `dispatcher.integration.test.ts`'s first test failed under a const version of this because its file-level static `import { redis } from "../../queue/redis-client"` evaluates `config.ts` (and freezes `VAPID_SUBJECT` etc. as `undefined`) before that test's `beforeEach` stubs the env - only `afterEach`'s `vi.resetModules()` forces a fresh read, which doesn't help the very first test in the file. A function sidesteps the ordering entirely by reading live on every call.
- **Trade-off**: `lib/queue/config.ts` is no longer queue-domain-only despite its path - it now also owns Redis connection and Web Push VAPID config, which a reader might expect to find colocated with `redis-client.ts`/`dispatcher.ts` instead. Accepted because the user explicitly asked for one central file over domain-local reads.
- **Scope**: Whole app - any future feature reading a new env var (server or `NEXT_PUBLIC_` client-side) should add it to `lib/queue/config.ts` following this function-per-value shape, not read `process.env` directly at the call site.
- **Date**: 2026-08-25
- **Status**: active

## Handoff

- **Feature**: idle-standby / `.specs/features/idle-standby/` - **VERIFIED (PASS)**, three Verifier passes
- **Phase / Task**: Medium-scope feature (Design/Tasks phases skipped per auto-sizing). All 4 execution-plan steps done, plus two follow-ups (env-configurable idle timeout, then centralizing all env reads per AD-003), on branch `feat/idle-standby-defense` (13 commits ahead of `development`). First Verifier pass: 7/7 ACs (IDLE-01-07) with `file:line` evidence, 149 unit tests (14 new), typecheck/lint/build clean, 3/3 discrimination-sensor mutations killed. Second pass re-checked the env-configurable-timeout follow-up: gate still 149/149, refactor behavior-preserving, client-bundle inlining independently reproduced. Third pass reviewed the AD-003 env-centralization refactor (out-of-spec, touches shared `queue-notifications` infra) for behavior-preservation rather than spec ACs: reproduced the function-vs-const bug in an isolated worktree (confirmed load-bearing, not cosmetic), full gate (149 unit + 70 integration) green, bundle security check confirmed no secret leak. See `.specs/features/idle-standby/validation.md` (all three passes recorded) - verdict PASS for the whole branch through commit `de374a7`.
- **Completed**: all 4 execution-plan steps (commits `f0cc6df` spec, `1fd7752` useQueue enabled option, `983240a` useIdleTimer, `a8efe82` Standby component, `2c087c6` page wiring) + first validation report (`99a6a35`) + env-var follow-up (`47340d1`) + second validation report (`1ac921d`) + STATE.md handoff update (`980dd8c`) + AD-003 env-centralization refactor (`de374a7`) + AD-003 decision + handoff update (`abf002c`) + third validation report (`5528f17`).
- **In-progress (file:line)**: none - working tree clean.
- **Next step**: No implementation or verification work pending - everything on the branch has a PASS. Merge/push remain - branch `feat/idle-standby-defense` is not yet merged into `development`/`main` or pushed to `origin`, needs explicit go-ahead per the skill's blast-radius rule.
- **Blockers**: none.
- **Uncommitted files**: none.
- **Branch**: `feat/idle-standby-defense`, 13 commits ahead of `development` (branched from `development`, not `main` - matches this repo's current working-branch convention) - not merged, not pushed.

**Other state to know on resume**: all local docker test stacks, dev servers, and scratch git worktrees used for manual/Verifier checks during this session were stopped and torn down each time - nothing left running as of the last commit. queue-notifications (prior feature) remains COMPLETE per its own validation.md, not yet merged/pushed as of that feature's last handoff (unchanged by this session, though its `dispatcher.ts`/`client.ts` files were touched by the AD-003 refactor above and re-verified passing).
