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

## Handoff

- **Feature**: idle-standby / `.specs/features/idle-standby/` - **VERIFIED (PASS)**
- **Phase / Task**: Medium-scope feature (Design/Tasks phases skipped per auto-sizing). All 4 execution-plan steps done and committed on branch `feat/idle-standby-defense` (5 commits ahead of `development`): spec, `useQueue` `enabled` option, `useIdleTimer` hook, `Standby` component, and the `app/page.tsx` wiring. A fresh Verifier confirmed 7/7 ACs (IDLE-01-07) with `file:line` evidence, a clean gate (149 unit tests, 14 new; typecheck/lint/build all clean), and 3/3 discrimination-sensor mutations killed. See `.specs/features/idle-standby/validation.md` - verdict PASS.
- **Completed**: all 4 steps (commits `f0cc6df` spec, `1fd7752` useQueue enabled option, `983240a` useIdleTimer, `a8efe82` Standby component, `2c087c6` page wiring), plus the validation report commit (`99a6a35`). The page-wiring step was also manually verified in a real browser (dev server + local `docker-compose.test.yml` Redis, screenshots of Landing and Standby, network trace confirming polling stops/resumes) before committing.
- **In-progress (file:line)**: none - working tree clean.
- **Next step**: No implementation work pending. Merge/push remain - branch `feat/idle-standby-defense` is not yet merged into `development`/`main` or pushed to `origin`, needs explicit go-ahead per the skill's blast-radius rule.
- **Blockers**: none.
- **Uncommitted files**: none.
- **Branch**: `feat/idle-standby-defense`, 5 commits ahead of `development` (branched from `development`, not `main` - matches this repo's current working-branch convention) - not merged, not pushed.

**Other state to know on resume**: the local docker test stack used for manual browser verification (`docker-compose.test.yml` - Redis + serverless-redis-http on ports 6379/8079) and the `npm run dev` server used for that check were both stopped and torn down at the end of the session - nothing left running. queue-notifications (prior feature) remains COMPLETE per its own validation.md, not yet merged/pushed as of that feature's last handoff (unchanged by this session).
