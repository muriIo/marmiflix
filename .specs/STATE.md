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

- **Feature**: queue-notifications / `.specs/features/queue-notifications/` - **VERIFIED (PASS)**, pending manual UAT
- **Phase / Task**: All 32 tasks (T1-T32) done and committed on branch `feat/queue-notifications` (worktree `.claude/worktrees/agent-a9530b73a3ea83b00`), 39 commits ahead of `main`. Fix round 1 (T26-T32) addressed all 5 gaps from the first Verifier pass; a fresh re-verification Verifier confirmed all 5 closed with `file:line` evidence, ran a clean gate (205 tests: 135 unit + 70 integration, 0 failed), and killed 4/4 discrimination-sensor mutations (including reproducing and killing the round-1 survivor). See `.specs/features/queue-notifications/validation.md` ("Re-verification (Fix Round 1)" section) - overall verdict PASS. A stray local branch `worktree-agent-a9530b73a3ea83b00` (one leftover commit of pre-implementation spec docs, diverged from this branch before real implementation started) was merged back in (`e199813`, trivial - its content was already fully superseded) and then deleted.
- **Completed**: T1-T32, plus both validation report commits (`c4849da` round 1, `4f238ca` round 2), the round-1 lessons commit (`1aad827`), and the stray-branch reconciliation merge (`e199813`).
- **In-progress (file:line)**: none - working tree clean.
- **Next step**: No implementation work pending. Two things remain, both optional/deferred by design: (1) Interactive UAT in a real browser for the SW (`public/sw.js`) and UI (`components/queue/*.tsx`) layers - 5 manual checklist items pre-flagged in `tasks.md` (T5, T20, T24, T25) as having no automated test path in this repo; (2) merge/push - branch `feat/queue-notifications` is not yet merged into `main` or pushed to `origin`, needs explicit go-ahead per the skill's blast-radius rule.
- **Blockers**: none.
- **Uncommitted files**: none.
- **Branch**: `feat/queue-notifications` (in the worktree above), 39 commits ahead of `main` - not merged, not pushed. The main checkout at `/home/murilo/projects/marmiflix` is back on a clean `main`, no stray branches remain.

**Other state to know on resume**: the docker test stack for this worktree (`docker-compose.test.yml` - Redis + serverless-redis-http, containers prefixed `agent-a9530b73a3ea83b00-`) was started during this re-verification session and is currently still running on ports 6379/8079 - stop it with `docker compose -f docker-compose.test.yml down` in the worktree dir if no longer needed. lunchbox-queue (prior feature) remains COMPLETE and merged into `main` via PR #1 - see `.specs/features/lunchbox-queue/validation.md` for its own history.
