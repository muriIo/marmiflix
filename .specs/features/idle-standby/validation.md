# Idle Standby Validation

**Date**: 2026-08-25
**Spec**: `.specs/features/idle-standby/spec.md`
**Diff range**: `c1a2fe905c94d0e5e08e6613c6d511acde32ca2e..feat/idle-standby-defense`
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

No `tasks.md` exists for this feature (only `spec.md`). 5 commits on the branch implement the full P1 slice (spec, `useQueue` enabled option, `useIdleTimer`, `Standby` component, `app/page.tsx` wiring). All code present and consistent with spec.

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| IDLE-01: idle timer runs and resets on qualifying activity while outside queue, connection healthy, view loaded | Timer resets on `mousemove`/`keydown`/`click`/`touchstart`/`scroll`/visibility-regain; only active when `outsideQueue` (connection ok, view loaded, `self.phase` undefined) | Reset-on-activity: `hooks/useIdleTimer.ts:20-44` (event listeners + `resetTimer`), tested `hooks/__tests__/useIdleTimer.test.ts:44-58` (`it.each` over all 5 activity events, `expect(onIdle).not.toHaveBeenCalled()` then fires after) and `:72-82` (visibility-regain resets, `expect(onIdle).not.toHaveBeenCalled()`). Gating condition: `app/page.tsx:57-58` `const outsideQueue = queue.connection === "ok" && queue.view !== null && queue.view.self?.phase === undefined;` wired into `useIdleTimer({ enabled: outsideQueue && !idle })` at `app/page.tsx:60-64` — **no automated test exercises this composed condition** (no `app/page.tsx` test exists; repo convention has no component/page tests). Manual verification claimed in commit `2c087c6`'s message. | ✅ PASS (timer-reset mechanics) / ⚠️ code-level + manual-verification only for the outside-queue/healthy/loaded gate (expected gap per task scope, flagged explicitly) |
| IDLE-02: WHEN idle timer reaches 180s THEN stop polling `GET /api/queue` and show Standby | Exactly 180,000ms timeout; polling stops; Standby screen shown | Timeout value: `app/page.tsx:15` `const IDLE_TIMEOUT_MS = 3 * 60 * 1000;` (=180000). Fire-at-180s: `hooks/__tests__/useIdleTimer.test.ts:6` `TIMEOUT_MS = 180_000`, `:35-42` `expect(onIdle).toHaveBeenCalledTimes(1)` after `vi.advanceTimersByTime(TIMEOUT_MS)`. Stop-polling mechanism: `hooks/__tests__/useQueue.test.ts:567-577` `expect(fetchMock).not.toHaveBeenCalled()` when `enabled:false`. Standby-display wiring (`onIdle: () => setIdle(true)` at `app/page.tsx:63`, `if (idle) return <Standby .../>` at `app/page.tsx:44-45`) is code-level only, no page test — manual verification claimed. | ✅ PASS (timeout value + stop-polling mechanics tested precisely) / ⚠️ UI-swap wiring code-level + manual only |
| IDLE-03: WHILE Standby displayed, SHALL NOT poll | Zero fetch calls while disabled | `hooks/__tests__/useQueue.test.ts:567-577` — `renderHook(() => useQueue({ enabled: false }))`, advance 10s, `expect(fetchMock).not.toHaveBeenCalled()`. Precisely matches spec outcome (zero requests). | ✅ PASS |
| IDLE-04: WHEN return button tapped THEN immediately resume polling and show Landing | Polling resumes with no extra delay beyond current cycle; Landing shown | Resume: `hooks/__tests__/useQueue.test.ts:599-616` — rerender `enabled:false→true`, `vi.advanceTimersByTimeAsync(0)`, `expect(fetchMock).toHaveBeenCalledTimes(1)` (immediate, zero-delay resume — precise match to "no extra delay"). Button wiring: `components/queue/Standby.tsx:12-16` `onClick={onReturn}`; `app/page.tsx:66` `handleReturnFromStandby = useCallback(() => setIdle(false), [])`; Landing fallthrough `app/page.tsx:47` `return <Landing queue={queue} />;` — code-level, no page/component test, manual verification claimed. | ✅ PASS (resume timing tested precisely) / ⚠️ button→state→Landing wiring code-level + manual only |
| IDLE-05: IF phase becomes waiting/confirming/heating THEN idle detection does not apply, keep polling regardless of activity | Idle never triggers; polling always continues once in queue | `lib/queue/types.ts:1` `export type Phase = "waiting" \| "confirming" \| "heating";` is exhaustive, so `queue.view.self?.phase === undefined` (`app/page.tsx:58`) is false whenever a phase is set, disabling `useIdleTimer` (`app/page.tsx:62`). Additionally `PhaseRouter` (`app/page.tsx:34-46`) checks `phase === "waiting"/"confirming"/"heating"` **before** the `idle` check, so even a stale `idle=true` cannot surface Standby once a phase exists. No automated test combines idle+phase transition (no page test) — code-level evidence + manual verification claimed. | ⚠️ Code-level PASS (exhaustive type + explicit precedence order), no automated integration test — expected gap, flagged |
| IDLE-06: SHALL NOT return from Standby except via explicit button (no passive auto-return) | Only the button click clears idle state | Single call site: `app/page.tsx:66` `setIdle(false)` only inside `handleReturnFromStandby`, only reachable via `Standby.tsx:14` `onClick={onReturn}`. `useIdleTimer` itself is disabled once idle (`enabled: outsideQueue && !idle` at `app/page.tsx:62`), and `hooks/__tests__/useIdleTimer.test.ts:84-91` confirms `enabled:false` never calls `onIdle`. No passive listener anywhere clears `idle`. Code-level only, no page test — manual verification claimed. | ⚠️ Code-level PASS, no automated test of this exact negative property — expected gap, flagged |
| IDLE-07: exact Standby copy | Message: "Você está no saguão. Nos avise quando quiser voltar para a fila." Button: "Voltar para a fila" | `components/queue/Standby.tsx:10` (message, byte-for-byte match) and `:17` (button label, byte-for-byte match to AC7's wording — note spec's Assumptions table row has a trailing period the AC7 line itself doesn't; implementation matches the governing AC, not the assumption row) | ✅ PASS |

**Status**: ⚠️ All 7 ACs functionally implemented and traced to evidence; IDLE-01/02/04/05/06 have precise automated coverage for their hook-level mechanics but rely on code-inspection + the commit's stated manual browser verification for the `app/page.tsx` composition/wiring layer, since no component/page tests exist anywhere in this repo (confirmed: `Landing.tsx`, `Waiting.tsx` etc. also have none). This is the expected, pre-scoped gap, not a new defect.

---

## Discrimination Sensor

Baseline `git status --porcelain` on real tree: empty, both before and after sensor work (confirmed).

Scratch: detached-HEAD git worktree at `2c087c6` (feat branch tip), never the real tree.

| Mutation | File:line | Description | Killed? |
| --- | --- | --- | --- |
| 1 | `hooks/useQueue.ts:139` | Inverted polling guard: `if (!enabled)` → `if (enabled)` (polling now runs only when *disabled*) | ✅ Killed — 12/25 tests failed in `useQueue.test.ts` |
| 2 | `hooks/useIdleTimer.ts:38` | Inverted visibility condition: `if (!document.hidden)` → `if (document.hidden)` (timer now resets while hidden, not on regain) | ✅ Killed — 2/11 tests failed in `useIdleTimer.test.ts` ("does not reset while hidden", "resets on visibility regain") |
| 3 | `hooks/useQueue.ts:70` | Flipped default: `enabled = true` → `enabled = false` | ✅ Killed — 9/25 tests failed in `useQueue.test.ts` (pre-existing polling-core tests that call `useQueue()` with no args) |

**Sensor depth**: lightweight (default tier, 3 mutations)
**Result**: 3/3 killed — PASS ✅

Cleanup verified: scratch worktree removed via `git worktree remove --force`, real-tree `git status --porcelain` re-checked empty (matches pre-sensor baseline).

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ — new hook, new component, minimal `useQueue`/`page.tsx` extension |
| Surgical changes | ✅ — only the 4 mapped files + tests touched |
| No scope creep | ✅ |
| Matches patterns | ✅ — `useIdleTimer` follows `useQueue`'s existing visibilitychange/cleanup idioms |
| Spec-anchored outcome check (asserted values match spec) | ✅ for hook-level ACs; ⚠️ page.tsx composition is code-level only (see table above) |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ⚠️ hook-level 1:1 met; `app/page.tsx` wiring layer has 0 automated tests (repo-wide convention, not a regression introduced by this feature) |
| Every test maps to a spec requirement - no unclaimed tests | ✅ — all new tests reference IDLE-01/02/03/04/05 in describe-block names |
| Documented guidelines followed | none found specific to this feature — strong defaults applied, matches existing `useQueue.test.ts` conventions |

---

## Edge Cases

- [x] Connection down (`ErrorScreen`) takes precedence over idle: `app/page.tsx:26-28` checks `connection === "down"` first, and `outsideQueue` (line 57-58) requires `connection === "ok"`, so idle timer is disabled too — double-enforced.
- [x] Queue view not loaded (`Loading`) — idle does not apply: `app/page.tsx:30-32` returns `Loading` before any phase/idle check, and `outsideQueue` requires `queue.view !== null` — double-enforced.
- [x] Tab-hidden pause in `useQueue` is independent of idle timer, and visibility-regain counts as idle-timer activity: `useQueue.ts`'s existing hidden/visibilitychange logic (lines 168-182, untouched by this diff) and `useIdleTimer.ts:36-42`'s separate visibilitychange handler are two independent effects with no shared state — confirmed by code read, no interaction bug found.

---

## Gate Check

- **Gate command**: `npm run test:unit` (no `tasks.md` exists for this feature; used the command named in the verification brief and matching `package.json`'s `test:unit` script)
- **Result**: 149 passed, 0 failed, 0 skipped
- **Test count before feature** (base commit `c1a2fe905c94d0e5e08e6613c6d511acde32ca2e`, verified via a temporary detached worktree, removed after): 135 (10 files)
- **Test count after feature**: 149 (11 files)
- **Delta**: +14 new tests (3 in `useQueue.test.ts`'s new "enabled option (IDLE-03/04)" block, 11 in the new `useIdleTimer.test.ts`)
- **Skipped tests**: none
- **Failures**: none

---

## Fix Plans

None required — no surviving mutants, no gate failures. The `app/page.tsx`/`Standby.tsx` wiring gap is a pre-existing, repo-wide convention (no component/page tests anywhere), explicitly pre-scoped as acceptable in the verification brief, not a new defect introduced by this feature.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| IDLE-01 | Implementing | ✅ Verified (hook mechanics tested; page-level gate code-reviewed + manually verified) |
| IDLE-02 | Implementing | ✅ Verified (timeout value + stop-polling tested; UI swap code-reviewed + manually verified) |
| IDLE-03 | Implementing | ✅ Verified |
| IDLE-04 | Implementing | ✅ Verified (resume timing tested; button/state wiring code-reviewed + manually verified) |
| IDLE-05 | Implementing | ✅ Verified (exhaustive type + code precedence; no automated integration test) |
| IDLE-06 | Implementing | ✅ Verified (single call-site code review; no automated integration test) |
| IDLE-07 | Implementing | ✅ Verified (exact string match) |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 7/7 ACs traced to file:line evidence; all match the spec-defined outcome at the hook level with precision (exact timeout values, exact call counts, exact strings). 5 of 7 ACs (IDLE-01/02/04/05/06) additionally depend on `app/page.tsx`/`Standby.tsx` composition that has no automated test — explicitly flagged per criterion above rather than silently passed, consistent with this repo's pre-existing no-component-test convention and the commit's stated manual browser verification.

**Sensor**: 3/3 mutations killed (enabled-guard inversion, visibility-condition inversion, default-value flip)

**Gate**: 149 passed, 0 failed, 0 skipped (+14 vs. pre-feature baseline of 135)

**What works**: `useQueue`'s `enabled` option correctly starts/stops the poll loop and resumes immediately; `useIdleTimer` correctly resets on all 5 specified activity events and on visibility regain, ignores hidden-tab time, and fires exactly once at the 180s threshold; `Standby.tsx` renders the exact specified pt-BR copy; `app/page.tsx` composes these so that phase-based screens always take precedence over idle (exhaustive `Phase` type + explicit check ordering), and idle is only clearable via the return button.

**Issues found**: None blocking. Sole gap: no automated test exists for the `app/page.tsx` composition (the `outsideQueue` gate, the idle→Standby swap, the button→Landing return) — this mirrors the repo's existing no-component-test convention (`Landing.tsx`, `Waiting.tsx` etc. also untested) and was pre-scoped as acceptable given manual verification in commit `2c087c6`. Not raised as a fix task per the verification brief's explicit instruction.

**Next steps**: None required to mark this feature done. If the team later adopts component/integration tests generally, `app/page.tsx`'s idle-gating composition (IDLE-01/05/06 in particular) would be the highest-value first target since it's the only layer currently unverified by automation.

---

## Re-verification (env var config) — 2026-08-25

**New commit**: `47340d1` "feat(idle-standby): make idle timeout configurable via env var" — refactors `lib/queue/config.ts` (`secondsFromEnv` split into `secondsFromString(raw, default)` + `secondsFromEnv(name, default)`), adds `IDLE_TIMEOUT_MS` export reading `NEXT_PUBLIC_QUEUE_IDLE_TIMEOUT_SECONDS` (default 180s), and switches `app/page.tsx` to import `IDLE_TIMEOUT_MS` from `lib/queue/config` instead of a local hardcoded constant. Also updates `spec.md`'s IDLE-02 assumption row and `.env.example`. Independent re-verifier, fresh session, no assumptions carried over from the prior PASS.

### Spec-anchored check

IDLE-02 assumption row (`.specs/features/idle-standby/spec.md:28`) now reads: "180 seconds (3 minutes) of no qualifying activity, default overridable via `NEXT_PUBLIC_QUEUE_IDLE_TIMEOUT_SECONDS` (client-inlined at build time, per `lib/queue/config.ts`'s existing env-config pattern)". Verified accurate: default is 180s (`lib/queue/config.ts:37` `secondsFromString(process.env.NEXT_PUBLIC_QUEUE_IDLE_TIMEOUT_SECONDS, 180) * 1000`), override works when the var is set at build time, and the change genuinely requires a rebuild (not a redeploy/restart) — confirmed empirically below. `.env.example:45-51` documents the same, correctly. ✅ PASS.

### Refactor equivalence (`secondsFromEnv` → `secondsFromString` + `secondsFromEnv`)

`lib/queue/config.ts:14-16`: `secondsFromEnv(name, defaultSeconds) { return secondsFromString(process.env[name], defaultSeconds); }` — a pure extraction; `secondsFromString`'s body (`config.ts:3-12`) is byte-for-byte the same logic the old `secondsFromEnv` had (falsy → default, non-finite/≤0 → default, else parsed value). Same inputs → same outputs for `CONFIRM_WINDOW_MS`, `HEATING_NOMINAL_MS`, `HEATING_URGENCY_MS`, `PER_PERSON_WAIT_MS` — confirmed by code diff (`git show 47340d1` — no logic changed, only extracted) and by the full `test:unit` suite still passing at the same 149-test count (no regression surfaced). No test file exists for `lib/queue/config.ts` (matches this repo's pre-existing convention — same gap noted for the original `secondsFromEnv` in the prior validation round; not a new gap from this commit). ✅ PASS.

### Gate check

| Command | Result |
| --- | --- |
| `npm run test:unit` | 149 passed, 0 failed, 0 skipped — same count as prior PASS (no tests added/removed by this commit, as expected) |
| `npm run typecheck` | clean, 0 errors |
| `npm run lint` | clean, 0 errors/warnings |
| `npm run build` (`rm -rf .next && npm run build`) | succeeded |

### Build-inlining verification (independently reproduced, not just trusted)

Baseline captured before touching anything: `.env.local` (gitignored, untracked) content and md5 recorded; `git status --porcelain` empty.

1. **Unset case**: `rm -rf .next && npm run build` with no `NEXT_PUBLIC_QUEUE_IDLE_TIMEOUT_SECONDS` anywhere. Compiled output: `.next/static/chunks/app/page-328bc3fca65ba208.js` contains `let O=1e3*q(T.env.NEXT_PUBLIC_QUEUE_IDLE_TIMEOUT_SECONDS,180)` where `T` is the module-scoped `process` shim (`var T=a(5704)`). **Nuance vs. the implementer's framing**: this is not literally replaced with `undefined` at build time — it remains a dynamic property read on the client's `process` shim. Root cause (confirmed by reading `node_modules/next/dist/build/../lib/static-env.js`'s `getNextPublicEnvironmentVariables()`): Next only creates a static-replacement entry for a `NEXT_PUBLIC_*` key that is actually present in `process.env` at build time (`for (const key in process.env) if (key.startsWith('NEXT_PUBLIC_')) ...`); an unset var gets no entry at all, so the literal member expression is left dynamic. At runtime the client's `process.env` shim has no such key, so the read evaluates to `undefined`, and `secondsFromString` correctly falls back to the 180 default — the functional outcome the spec requires is still correct, just via a runtime fallback rather than a build-time literal substitution. Confirmed this is standard, documented Next.js behavior (not specific to this codebase) by reading the Next.js source directly, and confirmed it does not vary based on literal-vs-bracket syntax — it varies on whether the key exists in `process.env` at all when Next builds.
2. **Set case**: added `NEXT_PUBLIC_QUEUE_IDLE_TIMEOUT_SECONDS=42` to `.env.local`, `rm -rf .next && npm run build`. Compiled output: `.next/static/chunks/app/page-35255fd0ef04169d.js` contains `let O=1e3*q("42",180)` — the literal string `"42"` is genuinely inlined, `T.env...` reference is gone entirely. This matches the implementer's claim precisely for the set case.
3. **Contrast/control**: confirmed the existing `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (set in `.env.local` throughout) is properly inlined as its literal key value in the same chunk (the variable name itself does not appear in the bundle, only the key string) — proving Next's inlining mechanism is genuinely active in this build/toolchain, and the unset-`IDLE_TIMEOUT_MS` case above is explained by the "not present at build time" rule, not a broken toolchain.
4. **Cleanup**: `.env.local` restored from the pre-test backup (md5 `a131f50e51ffab88a0e4407b2e8b7684`, byte-identical), confirmed via diff. Final `rm -rf .next && npm run build` run with no test var set, matching what an ordinary contributor would produce. `git status --porcelain` empty before, during (implicitly, since `.env.local`/`.next` are gitignored and untracked), and after — real tracked tree untouched throughout.

**Verdict on this check**: ✅ PASS with a documented nuance — the override works correctly and requires a rebuild as claimed; the "unset → inlined as literal undefined" framing is not exactly what happens (it's a dynamic read resolved by the client process shim instead), but the resulting behavior (falls back to 180) is identical and correct, and this is standard Next.js behavior rather than a defect introduced by this commit.

### Code quality observation (non-blocking)

Importing `IDLE_TIMEOUT_MS` from `lib/queue/config.ts` into `app/page.tsx` (a client component) pulls the *entire* module into the client bundle, including the other four exports (`CONFIRM_WINDOW_MS`, `HEATING_NOMINAL_MS`, `HEATING_URGENCY_MS`, `PER_PERSON_WAIT_MS`) that were previously server-only — confirmed present in the compiled client chunk (`A("QUEUE_CONFIRM_WINDOW_SECONDS",60)` etc. alongside the idle constant). These read non-`NEXT_PUBLIC_` env vars via dynamic `process.env[name]`, which are simply always `undefined` client-side and fall back to their defaults — no secret exposure (values are just timing numbers, not sensitive) and no functional bug, just a few bytes of avoidable client bundle bloat from a module that mixes client- and server-intended constants. Not spec-relevant and not raised as a fix task; noted for future awareness only.

### Updated verdict

**Overall**: ✅ PASS (re-verification). Gate: 149/149 unit tests passed, typecheck clean, lint clean, build succeeded, both unset-default and set-override paths independently confirmed correct at runtime (default falls back to 180; override is genuinely honored when present at build time). No regression in `CONFIRM_WINDOW_MS`/`HEATING_NOMINAL_MS`/`HEATING_URGENCY_MS`/`PER_PERSON_WAIT_MS` behavior. `.env.local` and working tree left exactly as found (verified via md5 and `git status --porcelain`).
