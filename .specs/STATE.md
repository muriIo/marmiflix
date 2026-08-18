# STATE

## Decisions

### AD-001
- **Decision**: marmiflix runs on Next.js (App Router, TypeScript) on Vercel, with a single Upstash Redis key (via the Vercel Marketplace integration) as the queue's data store, atomicity via a version-field compare-and-swap (tiny generic Lua script) rather than a full Lua state machine, and realtime sync via client polling (~2s, visibility-paused, exponential backoff) rather than websockets/push.
- **Reason**: Simplest stack that meets the spec's 3s realtime bound and handles serverless-safe deadline timeouts (lazy reap-on-read) without needing a persistent process or a cron job; keeps all business logic in unit-testable TypeScript instead of Lua.
- **Trade-off**: Not true push-based realtime (small polling delay, more request volume than websockets); single Redis key is a write-contention point under heavy concurrent load. Both are explicitly named as the first things to revisit (e.g. swap to Supabase Realtime) if usage ever outgrows this.
- **Scope**: Whole app (only feature so far: lunchbox-queue) - any future feature touching queue state or realtime sync must conform or explicitly supersede this.
- **Date**: 2026-08-18
- **Status**: active

## Handoff

- **Feature**: lunchbox-queue / `.specs/features/lunchbox-queue/`
- **Phase / Task**: Phase 6 (UI Screens) / T29 - Landing screen, in progress (not committed)
- **Completed**: T1-T28 (all committed, gates green - Phases 1-4 fully done; Phase 5 Client Identity & Polling Hook fully done; Phase 6 started with T28 app shell committed)
- **In-progress (file:line)**: `components/queue/Landing.tsx` (uncommitted edit - name-entry form, queue count/ETA display, error handling via `QueueActionError`, pt-BR copy, looks functionally close to done at ~90 lines) and `lib/format.ts` (new, untracked - `formatDuration(ms)` helper, appears complete). Neither has been gate-checked or gated against T29's "Done when" list yet; the specific duplicate-name-409 toast wording ("Esse nome já está na fila") should be double-checked against what `QueueActionError.message` actually carries from the join route.
- **Next step**: Finish T29 (run `npm run lint`/`typecheck`/`build`, manually verify the join flow in a browser, check off T29's Done-when boxes in `tasks.md`, commit), then resume Batch 4 through T30-T35 (Waiting, ConfirmTurn, Heating, ErrorScreen, audible cue, deployment runbook) - the batch was mid-T29 when it was killed by the user (not a technical blocker), so it's a straightforward resume, not a fix.
- **Blockers**: none technical. The prior batch-4 sub-agent was killed by explicit user action mid-task; no error to diagnose.
- **Uncommitted files**: `components/queue/Landing.tsx` (modified), `lib/format.ts` (new/untracked). Also: `.claude/skills/tlc-spec-driven/scripts/check_commit.py` shows a harmless file-mode-only diff (100644→100755) from wiring it up as the `.git/hooks/commit-msg` guard earlier in this session - not part of any task, safe to ignore or commit separately at will.
- **Branch**: main (2 commits ahead of `origin/main` as of the last check before this session, plus everything from T1-T28 - not yet pushed; push needs explicit go-ahead per the skill's blast-radius rule)

**Other state to know on resume**: 87+ tests passing as of T28 (52 unit + 35 integration). A Docker test stack (`docker compose -f docker-compose.test.yml up -d` - Redis + `serverless-redis-http`) was left running in a prior session's Bash environment; it will need to be started again in whatever environment resumes this (`docker compose -f docker-compose.test.yml up -d`) since containers don't survive a session/session-host restart. The `frontend-design` plugin was installed (user scope) mid-session for T28-T34's UI work - confirm it's actually invocable after restart (a plugin install sometimes needs a restart to load, which this session restart should satisfy).
