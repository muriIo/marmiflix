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

- **Feature**: lunchbox-queue / `.specs/features/lunchbox-queue/` - **COMPLETE**
- **Phase / Task**: All 7 phases / all 35 tasks (T1-T35) done and committed. Verifier ran and returned PASS (see `.specs/features/lunchbox-queue/validation.md`): 110/110 tests green, 3/3 discrimination-sensor mutants killed, 22/23 spec-anchored ACs matched exactly (1 documented spec-precision gap on QUEUE-18's "3s" bound, satisfied by construction via the 2s poll interval but not directly measured by an e2e test - not a blocker).
- **Completed**: T1-T35, plus the validation report + lessons commit (`cc736a1`).
- **In-progress (file:line)**: none - working tree is clean apart from the pre-existing harmless `check_commit.py` file-mode diff (100644->100755, safe to ignore or commit separately at will).
- **Next step**: No implementation work pending. Two candidate lessons (L-001, L-002) sit in `.specs/lessons.json` at `candidate` status awaiting promotion/review per the skill's lessons workflow - optional. Otherwise the only remaining actions are remote/deploy ones requiring explicit go-ahead: `git push` (branch is ahead of `origin/main`), and actually executing `DEPLOYMENT.md`'s steps (create the Vercel project, install the Upstash Marketplace integration, add the `marmiflix.cruz.dev.br` domain + DNS record).
- **Blockers**: none.
- **Uncommitted files**: none (aside from the harmless `check_commit.py` mode diff noted above).
- **Branch**: main, ahead of `origin/main` by the full feature history - not yet pushed; push needs explicit go-ahead per the skill's blast-radius rule.

**Other state to know on resume**: Docker test stack (`docker compose -f docker-compose.test.yml up -d` - Redis + `serverless-redis-http`) and any `next dev` server were stopped and `queue:state` cleared in Redis at the end of this session - start fresh if resuming manual testing.
