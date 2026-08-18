# Lunchbox Heating Queue Specification

## Problem Statement

Office employees currently crowd around a single microwave with an unorganized stack of thermal lunchboxes, with no way to know whose turn is next. This wastes time and creates daily congestion. This feature replaces the physical stack with a simple, real-time digital queue so every employee knows exactly when their turn starts, without anyone managing it manually.

## Goals

- [ ] Employees can join a single shared heating queue and see an accurate estimate of when their turn starts.
- [ ] The queue automatically advances turns (including no-shows and timeouts) without any employee manually tracking or announcing whose turn it is.
- [ ] Every employee sees the same queue state in real time, without needing to refresh the page.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| Multiple microwaves / multiple simultaneous queues | Only one microwave exists today; adds real complexity not needed for MVP |
| User accounts, login, or office-wide authentication | Internal tool; name-only identification is sufficient for MVP |
| Push notifications for closed/backgrounded browser tabs | Requires service worker + push infrastructure; vibration/animation while the tab is open covers the primary use case |
| Queue history, usage analytics, or an admin dashboard | Not requested; no reporting need identified yet |
| Priority queueing or reserved slots | Strict FIFO only; no stated business need for priority |
| Automatic requeue after a missed confirm-turn window | Visitor must rejoin manually; keeps timeout logic simple |
| Multi-language support / language switcher | Office audience is pt-BR only; no i18n infrastructure needed |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Identification method | Name-only, no login; browser remembers the visitor via local storage | Matches "start with the simplest way"; no auth infra needed for an internal office tool | y |
| Early finish during heating | Single continuous "I'm Done" button, tappable any time from 0:00 up to 5:15 | Merges "early finish" and "confirm you finished" into one action/state - simplest model | y |
| First-in-empty-queue behavior | Skips straight to the confirm-turn screen (animation + vibration + 20s window), not to the waiting screen | Directly confirmed; the "your turn" screen IS the confirm-turn screen | y |
| Waiting-position abandonment | No timeout while merely waiting; only enforced once it becomes the visitor's turn (20s confirm-turn window) | Directly confirmed; avoids building a heartbeat/last-seen mechanism for the MVP | y |
| Confirm-turn timeout consequence | Visitor is removed from the queue entirely and returned to the home screen; must rejoin from scratch | Directly confirmed | y |
| Confirmation actions | Require an explicit button tap ("I'm Here" / "I'm Done") | Directly confirmed; unambiguous and testable vs. inferring presence from tab focus | y |
| Realtime staleness bound | All connected clients converge on a state change within 3 seconds | Imperceptible for a queue use case; keeps backend choice (polling vs. push) a Design-phase decision | n |
| Authentication / access control | None - app is reachable by anyone who has the subdomain URL | Internal small-office tool; matches "start simple, escalate if needed" | n |
| Persistent history / analytics | None - queue entries are ephemeral and discarded once processed | Not requested; add later if a real need shows up | n |
| Wait-time estimate formula | Active turn's remaining time + 5 minutes for every person ahead in the queue | Simplest defensible estimate; excludes confirm-window buffers since those are short and best-case | n |
| Number of queues | Exactly one global queue (one microwave) | Matches the described problem; multiple queues is explicitly out of scope | n |
| Backgrounded/closed-tab behavior | Vibration and animation only fire while the tab is open and in the foreground; no other notification channel | Push notifications require service worker infrastructure, contradicts "start simple" | n |
| Duplicate active entries | Blocked - a visitor cannot have two active entries under the same name (case-insensitive, trimmed) at once | Prevents one person occupying multiple queue slots; cheap to check | n |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: See Queue Status and Join ⭐ MVP

**User Story**: As an employee, I want to see the current queue status and join it, so that I know if it's worth waiting and can claim my place.

**Why P1**: Entry point for the whole feature - nothing else works without it.

**Acceptance Criteria**:

1. WHEN a visitor opens the site THEN the system SHALL display the number of people currently in the queue and the visitor's estimated wait time if they joined right now.
2. WHEN a visitor taps "Join Queue" AND both the queue and the active-turn slot are empty THEN the system SHALL place them directly into the confirm-turn state, skipping the waiting screen.
3. WHEN a visitor taps "Join Queue" AND the queue or the active-turn slot is occupied THEN the system SHALL append them to the end of the queue and show them the waiting screen.
4. The system SHALL require a non-empty display name to join the queue.
5. The system SHALL display all user-facing text in Brazilian Portuguese (pt-BR).

**Independent Test**: Open the site with an empty queue, confirm the "no wait" state, join, and verify landing directly in confirm-turn. Then open a second browser, join, and verify it sees a waiting screen with position 2.

---

### P1: Wait My Turn ⭐ MVP

**User Story**: As a waiting employee, I want to see my live position and estimated wait time, so that I know when to head to the microwave, and I want to be able to leave if my plans change.

**Why P1**: Core value of a queue - visibility while waiting.

**Acceptance Criteria**:

1. WHILE a visitor is in the waiting state, the system SHALL display their live queue position and an estimated wait time, computed as the active turn's remaining time plus 5 minutes for every person ahead of them in the queue.
2. WHEN a waiting visitor taps "Leave Queue" THEN the system SHALL remove them from the queue and return them to the landing page.
3. The system SHALL preserve a visitor's place in the queue across a page reload, identified by their browser's stored session for that name.

**Independent Test**: Join as the 2nd person, reload the page and confirm position/ETA persist, then tap "Leave Queue" and confirm removal from the live queue view on another browser.

---

### P1: Confirm and Take My Turn ⭐ MVP

**User Story**: As the next employee in line, I want to be clearly notified it's my turn and confirm I'm there, so that the microwave slot isn't wasted on someone who stepped away.

**Why P1**: The turn hand-off is the mechanism that keeps the queue moving.

**Acceptance Criteria**:

1. WHEN a visitor's queue entry reaches the front (no one currently active) THEN the system SHALL move them into the confirm-turn state, trigger a device vibration (WHERE supported), and play the "your turn" animation.
2. WHILE a visitor is in the confirm-turn state, the system SHALL display a 20-second countdown and an "I'm Here" button.
3. WHEN the visitor taps "I'm Here" within the 20-second window THEN the system SHALL start their active-heating turn.
4. IF the 20-second confirm-turn window elapses without the visitor tapping "I'm Here" THEN the system SHALL remove the visitor from the queue entirely, return them to the landing page, and advance the next person (if any) into the confirm-turn state.
5. WHERE the visitor's device supports the Vibration API THEN the device SHALL vibrate when entering the confirm-turn state.

**Independent Test**: As the front-of-queue visitor, let the 20s window expire without tapping and verify removal + the next person is promoted to confirm-turn. Repeat and tap "I'm Here" in time, verifying the transition to active heating.

---

### P1: Heat My Lunchbox ⭐ MVP

**User Story**: As the active employee, I want a running timer and a way to say I'm done whenever I actually finish, so that I don't block the next person longer than necessary.

**Why P1**: The actual "doing the task" state of the queue.

**Acceptance Criteria**:

1. WHEN a visitor's active-heating turn starts THEN the system SHALL display a running timer starting at 0:00 and an "I'm Done" button.
2. WHEN the visitor taps "I'm Done" at any point from 0:00 up to 5 minutes 15 seconds THEN the system SHALL immediately end their turn and advance the next person (if any) into the confirm-turn state.
3. IF the active-heating timer reaches 5 minutes 15 seconds without the visitor tapping "I'm Done" THEN the system SHALL auto-end their turn and advance the next person (if any) into the confirm-turn state.
4. WHILE the active-heating timer is between 5:00 and 5:15, the system SHALL visually flag that time is almost up.
5. WHEN an active-heating turn ends and the queue is empty THEN the system SHALL return the queue to the empty state.

**Independent Test**: Start a turn, tap "I'm Done" at 0:30 and verify immediate advance. Start another turn and let it run past 5:15 untouched, verifying auto-advance and the urgency flag shown between 5:00-5:15.

---

### P1: Stay in Sync ⭐ MVP

**User Story**: As any employee viewing the app, I want the queue to update live on my screen, so that I never act on stale information.

**Why P1**: Without this, the queue is not trustworthy - the whole point is replacing word-of-mouth coordination.

**Acceptance Criteria**:

1. WHEN any queue state changes (join, leave, turn advance, timeout) THEN the system SHALL reflect that change on every connected client's screen within 3 seconds.
2. The system SHALL enforce first-in-first-out ordering for queue position assignment, resolving simultaneous join requests without ever assigning two visitors the same position or the same active-turn slot.

**Independent Test**: With two browsers open side by side, join from one and confirm the other's queue count updates within 3 seconds without a manual refresh.

---

### P2: Prevent Duplicate Active Entries

**User Story**: As the system, I want to block a visitor from holding two active queue entries under the same name, so that one person can't occupy multiple slots.

**Why P2**: Data-integrity safeguard, not required to demo the core loop.

**Acceptance Criteria**:

1. IF a visitor attempts to join while an entry with the same name (case-insensitive, trimmed) is already active (waiting, confirming turn, or heating) THEN the system SHALL reject the join and show a message that the name is already in the queue.

**Independent Test**: Join as "Ana", then attempt to join again as "ana " (different case/whitespace) and confirm rejection.

---

### P2: See Who's Ahead

**User Story**: As a waiting employee, I want to see the names of the people ahead of me, so that I can coordinate informally (e.g., "hey, can I go before you, mine's quick").

**Why P2**: Nice coordination aid, not required for the queue to function.

**Acceptance Criteria**:

1. WHILE a visitor is in the waiting state, the system SHALL display the display names of everyone ahead of them, in order.

**Independent Test**: Join as three visitors in sequence and verify the 3rd sees the 1st and 2nd names, in join order.

---

### P3: Audible Cue

**User Story**: As an employee, I want an optional sound alongside the vibration and animation, so that I notice my turn even if my phone isn't in my hand.

**Why P3**: Pure enhancement on top of the already-required vibration/animation notification.

**Acceptance Criteria**:

1. WHERE the browser tab is in the foreground and not muted THEN the system SHALL play a short sound when entering the confirm-turn state, in addition to the vibration and animation.

---

## Edge Cases

- IF a visitor's device does not support the Vibration API THEN the system SHALL still show the confirm-turn animation and 20-second window (vibration is additive, not required - see P1 Confirm-Turn AC5).
- IF a visitor closes their tab while merely waiting (not yet confirm-turn or active) THEN the system SHALL keep their entry in the queue until they either return and tap "Leave Queue," or their turn arrives and the confirm-turn timeout removes them.
- IF a visitor closes their tab during their active-heating turn and never returns THEN the system SHALL auto-end their turn at 5:15 per the standard timeout rule (no special-cased handling).
- WHEN the queue is empty and no one is in the active-turn slot THEN the landing page SHALL indicate "no wait - join now" rather than showing a stale or zero estimate that could be misread.

---

## Requirement Traceability

Each requirement gets a unique ID for tracking across design, tasks, and validation.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| QUEUE-01 | P1: See Queue Status and Join | Design | Pending |
| QUEUE-02 | P1: See Queue Status and Join | Design | Pending |
| QUEUE-03 | P1: See Queue Status and Join | Design | Pending |
| QUEUE-04 | P1: See Queue Status and Join | Design | Pending |
| QUEUE-05 | P1: Wait My Turn | Design | Pending |
| QUEUE-06 | P1: Wait My Turn | Design | Pending |
| QUEUE-07 | P1: Wait My Turn | Design | Pending |
| QUEUE-08 | P1: Confirm and Take My Turn | Design | Pending |
| QUEUE-09 | P1: Confirm and Take My Turn | Design | Pending |
| QUEUE-10 | P1: Confirm and Take My Turn | Design | Pending |
| QUEUE-11 | P1: Confirm and Take My Turn | Design | Pending |
| QUEUE-12 | P1: Confirm and Take My Turn | Design | Pending |
| QUEUE-13 | P1: Heat My Lunchbox | Design | Pending |
| QUEUE-14 | P1: Heat My Lunchbox | Design | Pending |
| QUEUE-15 | P1: Heat My Lunchbox | Design | Pending |
| QUEUE-16 | P1: Heat My Lunchbox | Design | Pending |
| QUEUE-17 | P1: Heat My Lunchbox | Design | Pending |
| QUEUE-18 | P1: Stay in Sync | Design | Pending |
| QUEUE-19 | P1: Stay in Sync | Design | Pending |
| QUEUE-20 | P2: Prevent Duplicate Active Entries | Design | Pending |
| QUEUE-21 | P2: See Who's Ahead | Design | Pending |
| QUEUE-22 | P3: Audible Cue | Design | Pending |
| QUEUE-23 | P1: See Queue Status and Join | Design | Pending |

**ID format:** `QUEUE-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 23 total, 0 mapped to tasks, 23 unmapped ⚠️ (expected pre-Design)

---

## Success Criteria

How we know the feature is successful:

- [ ] A visitor can join, wait, get notified (vibration + animation), confirm their turn, heat, and finish - entirely from their own phone, without asking anyone else about the queue state.
- [ ] Two or more browsers open at once show the same queue position/timer, converging within 3 seconds of any change.
- [ ] No two visitors are ever assigned the active-heating slot at the same time, even under simultaneous join attempts.
- [ ] A visitor who doesn't confirm their turn within 20s, or doesn't confirm finishing within 5:15, never permanently blocks the queue.
