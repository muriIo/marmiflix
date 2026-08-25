# Idle Standby Specification

## Problem Statement

A visitor who opens the app but never joins the queue (the Landing screen) is polled by `useQueue` every ~2s indefinitely, even if they walk away and leave the tab open. Unlike a visitor actually waiting in the queue - who needs live status - an idle, not-yet-joined visitor gains nothing from this polling, and it burns Vercel edge requests for no benefit. This feature stops that waste by detecting idleness outside the queue and pausing polling until the visitor deliberately signals they're still interested.

## Goals

- [ ] A visitor idle on the Landing screen for 3 minutes stops generating `GET /api/queue` requests entirely.
- [ ] A visitor actually in the queue (waiting/confirming/heating) is never affected - they keep polling regardless of activity, since they need live status.
- [ ] Returning from idle is a single deliberate action (a button tap), not silently inferred from passive signals.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Reduced-rate (not fully stopped) polling while idle | User explicitly chose full stop over a slower background poll |
| Auto-return to Landing from activity detected on the Standby screen | User explicitly chose an explicit button as the only way back, to validate real intent to join |
| Idle detection while in the queue (waiting/confirming/heating) | Those visitors need live status; only the not-yet-joined state is idle-eligible |
| Server-side idle tracking or session expiry | Purely a client-side polling-cost optimization; no backend or data-lifecycle change |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Idle threshold | 180 seconds (3 minutes) of no qualifying activity | Directly specified by user | y |
| Scope of idle detection | Only while outside the queue (`self.phase` undefined, i.e. the Landing screen) | Directly confirmed - queued visitors always need live status | y |
| Behavior on idle timeout | Stop polling `GET /api/queue` entirely and show a new Standby screen instead of Landing | Directly confirmed over the reduced-polling alternative | y |
| Qualifying activity (resets the timer) | `mousemove`, `keydown`, `click`, `touchstart`, `scroll`, and the tab regaining visibility (`visibilitychange` -> not hidden) | Directly confirmed; visibility-regain counts because "no harm in being active" reflects real intent, same as an input event | y |
| Return path from Standby | Single button, resumes polling immediately and returns to Landing; no passive/automatic return | Directly confirmed - explicit action validates real intent to (re)join | y |
| Precedence vs. connection-down / loading states | Idle detection never applies while `ErrorScreen` (connection down) or `Loading` (view not yet loaded) is shown | These states already fully own the screen and have no "outside queue, idle" meaning; avoids a second competing takeover of the UI | n |
| Standby screen copy (pt-BR) | Message: "Você está no saguão. Nos avise quando quiser voltar para a fila." Button label: "Voltar para a fila." | Directly specified by user; matches the app's existing pt-BR-only copy convention | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Stop Idle Polling Outside the Queue ⭐ MVP

**User Story**: As a visitor who opened the app but isn't in the queue, if I walk away and leave the tab open, I want the app to stop pestering the server on my behalf, so it doesn't waste request budget for a page I'm not looking at.

**Why P1**: This is the entire feature - a single vertical slice (detect idle -> stop polling -> show a way back).

**Acceptance Criteria**:

1. WHILE a visitor is outside the queue (`self.phase` is undefined) and the connection is healthy and the queue view has loaded, the system SHALL run an idle timer that resets on any qualifying activity (`mousemove`, `keydown`, `click`, `touchstart`, `scroll`, or the tab regaining visibility).
2. WHEN that idle timer reaches 180 seconds without qualifying activity THEN the system SHALL stop polling `GET /api/queue` and display the Standby screen in place of the Landing screen.
3. WHILE the Standby screen is displayed, the system SHALL NOT poll `GET /api/queue`.
4. WHEN the visitor taps the Standby screen's return button THEN the system SHALL immediately resume polling `GET /api/queue` and display the Landing screen.
5. IF the visitor's queue phase becomes `waiting`, `confirming`, or `heating` (e.g., they join before the idle timer elapses) THEN the system SHALL NOT apply idle detection, and SHALL keep polling regardless of activity.
6. The system SHALL NOT return a visitor from the Standby screen to Landing except via the explicit return button (no passive-activity auto-return).
7. The system SHALL display the message "Você está no saguão. Nos avise quando quiser voltar para a fila." and a button labeled "Voltar para a fila" on the Standby screen.

**Independent Test**: On the Landing screen, stop interacting for 180 seconds and verify polling stops and the Standby screen appears; tap the return button and verify polling resumes immediately and Landing reappears. Separately, join the queue and confirm no idle timeout ever interrupts the waiting/confirming/heating screens no matter how long the tab is left untouched.

---

## Edge Cases

- IF the connection is down (`ErrorScreen` shown) THEN idle detection SHALL NOT trigger a transition to the Standby screen (`ErrorScreen` takes precedence).
- IF the queue view has not yet loaded (`Loading` shown) THEN idle detection SHALL NOT apply.
- WHEN the tab is hidden (`document.hidden`) THEN the existing polling pause (already implemented in `useQueue`) SHALL continue to apply independently of the idle timer; the tab regaining visibility counts as qualifying activity per AC1.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| IDLE-01 | P1: Stop Idle Polling Outside the Queue | - | Pending |
| IDLE-02 | P1: Stop Idle Polling Outside the Queue | - | Pending |
| IDLE-03 | P1: Stop Idle Polling Outside the Queue | - | Pending |
| IDLE-04 | P1: Stop Idle Polling Outside the Queue | - | Pending |
| IDLE-05 | P1: Stop Idle Polling Outside the Queue | - | Pending |
| IDLE-06 | P1: Stop Idle Polling Outside the Queue | - | Pending |
| IDLE-07 | P1: Stop Idle Polling Outside the Queue | - | Pending |

**ID format:** `IDLE-[NUMBER]`

**Status values:** Pending -> In Design -> In Tasks -> Implementing -> Verified

**Coverage:** 7 total, 0 mapped to tasks, 7 unmapped (expected pre-Execute; this is a Medium-scope feature with Design/Tasks phases skipped per the auto-sizing rubric - mapping happens inline during Execute)

---

## Success Criteria

- [ ] A visitor idle on Landing for 180s generates zero further `/api/queue` requests until they tap the return button.
- [ ] A visitor actually in the queue is never shown the Standby screen or interrupted, regardless of idle time.
- [ ] Tapping the Standby return button resumes normal ~2s polling immediately (no extra delay beyond the existing poll cycle).
