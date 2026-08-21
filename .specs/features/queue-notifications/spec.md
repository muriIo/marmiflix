# Queue Notifications & Seat Limit Specification

## Problem Statement

Right now a visitor only finds out their turn started, their heating time is up, or a seat freed up if they're staring at the open tab - the current design (`lunchbox-queue`) explicitly relies on sound/vibration/animation while the tab has focus and nothing otherwise. That fails the moment someone steps away, backgrounds the tab, or closes it on mobile - exactly the moments the queue is designed to free them for. This feature adds a real out-of-tab notification channel (Web Push) for those moments, widens two windows that are currently too tight to comfortably react to a live tab, and stops the queue from growing unbounded by capping it at 100 seats with an opt-in "notify me" path for latecomers.

## Goals

- [ ] A visitor with the tab backgrounded or closed still gets alerted (via Web Push) at the four moments that matter: their turn starts, their heating time is up, their confirm-finish grace is about to expire, and a seat opens up after the queue was full.
- [ ] A visitor with the tab focused gets alerted via sound/vibration for those same moments - never a redundant OS push notification while they're already looking at the screen.
- [ ] All four scenarios route through one extensible notification-dispatch interface, so a fifth scenario in the future is a new call site, not new channel-selection logic.
- [ ] The confirm-turn window grows from 20s to 60s and the heating auto-end grace grows from 15s to 30s, giving visitors realistic time to react.
- [ ] The queue never exceeds 100 concurrent entries (active + waiting); once full, new visitors get an opt-in "notify me when a seat opens" screen instead of being turned away with no path forward.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| Multiple push subscriptions / devices per visitor | Name-only single-browser session model (unchanged from `lunchbox-queue`); adding multi-device support means adding an account system first |
| Reserved/held seats for waitlisted visitors (FIFO hold) | Explicitly declined in Discuss - broadcast + first-to-join-wins matches the existing no-reservation join philosophy (AD-001) and avoids a second timeout subsystem |
| A distinct "confirming finish" phase with its own explicit confirm button | Explicitly declined in Discuss - the simpler "just widen the existing grace window" option was chosen instead |
| Admin dashboard / visibility into the waitlist or subscriber counts | Not requested; no reporting need identified, consistent with parent spec's scope |
| Waitlist size cap | No stated need; revisit only if it becomes a real scaling concern |
| Retry/backoff on failed push delivery | Best-effort delivery; an expired/invalid subscription (410/404 from the push service) is pruned, not retried |
| Native mobile app push (APNs/FCM native SDKs) | Web-only app; Web Push via VAPID covers browsers on both desktop and mobile without a native app |
| Custom CSRF token scheme | Superseded by the existing bearer-session-token pattern already used by every mutation route - no cookie, no ambient credential, nothing for a forged cross-site request to ride on |
| i18n / non-pt-BR notification text | Inherited from parent spec - pt-BR only |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Confirm-finish flow shape | No new phase; widen the existing single "heating" phase's tail grace from 15s to 30s, with two elapsed-time notification checkpoints inside it (5:00 and 5:20) | User picked this over a distinct "confirming finish" phase | y |
| Push permission trigger | Inline opt-in control on the Join form (and an equivalent one on the queue-full screen); permission requested only as part of that submit gesture | User picked this over a standalone "enable notifications" banner | y |
| Full-queue waitlist fairness | Broadcast to everyone on the waitlist when a seat frees up; no reservation, first successful join wins | User picked this over FIFO-with-hold and FIFO-notify-only | y |
| Focus-detection mechanism | The server always sends a push to every subscribed recipient when a scenario fires; the visitor's **service worker** decides at delivery time (via `clients.matchAll()` + `WindowClient.focused`) whether to actually show an OS notification or suppress it because a focused tab is already handling sound/vibration | Resolved during Design via research (MDN/web.dev): only the browser knows live focus state without staleness, so pushing the decision to the SW avoids inventing a server-side heartbeat entirely - see `design.md` | y (refined in Design) |
| Push transport | VAPID-authenticated Web Push (RFC 8292), server-side only, no third-party push service (e.g. FCM) | Works natively against every major browser's push service; no extra account/infra; matches the MDN Push API reference the user pointed to | n |
| Push-endpoint auth | Same bearer session-token pattern as `confirm-turn`/`finish`/`leave` (`lib/queue/route-helpers.ts`); the waitlist (no existing entry) gets its own opaque token minted and returned at registration time, hashed and verified the same way | Reuses an already-reviewed, cookie-free pattern that is structurally immune to CSRF instead of introducing a second auth scheme | n |
| Subscription lifecycle | A push subscription is stored alongside the queue entry (or waitlist registration) it belongs to and is discarded whenever that entry is (leave, confirm-turn timeout, finish, or a successful join consuming a waitlist registration) | No separate cleanup job needed; mirrors how the rest of queue state is already ephemeral | n |
| Waitlist registration requirement | No display name required to register for "notify me when a seat opens" - only a push subscription (or, if push isn't grantable, the registration is a no-op since there's no sound/vibration channel possible on a screen the visitor isn't watching) | The visitor still goes through the normal Join form (name included) once notified; asking for a name twice adds friction with no benefit | n |
| Seat-cap scope | 100 counts `active` (0 or 1) + all `waiting` entries combined | Matches "100 users in the queue" read literally - the active slot holds one of those 100 | n |
| Notification content / copy | Short pt-BR strings per scenario (e.g. "Chegou sua vez!", "Tempo de aquecimento esgotado", "Últimos 10s para confirmar", "Vaga liberada na fila!"), finalized during Design/Tasks, not the spec | Copy is an implementation/Design-phase detail, not a product-scope decision | n |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Get Notified When It's My Turn ⭐ MVP

**User Story**: As a waiting employee, I want to be alerted the moment my turn starts - even with the tab backgrounded or closed - so that I don't lose my slot to the confirm-turn timeout without knowing it started.

**Why P1**: This is the scenario the whole feature exists to fix - the queue's core hand-off moment is exactly when visitors are most likely to have wandered away from the tab.

**Acceptance Criteria**:

1. WHEN a visitor's queue entry transitions from waiting to the confirming phase THEN the system SHALL trigger the turn-notification event for that visitor.
2. WHILE the visitor's tab has focus, WHEN the turn-notification event fires THEN the system SHALL play an audible cue and trigger a device vibration (WHERE the Vibration API is supported), without sending a Web Push message.
3. WHILE the visitor's tab does not have focus AND the visitor holds a valid push subscription for this entry, WHEN the turn-notification event fires THEN the system SHALL deliver a Web Push notification announcing their turn via that subscription.
4. IF the visitor holds no valid push subscription for this entry AND the tab does not have focus THEN the system SHALL NOT deliver any notification for that event.
5. The system SHALL use a 60-second confirm-turn window (amends the parent spec's 20-second QUEUE-08/QUEUE-09 bound).
6. IF the 60-second confirm-turn window elapses without the visitor tapping "I'm Here" THEN the system SHALL remove the visitor from the queue and advance the next person into the confirming phase, per the parent spec's existing timeout behavior with the new 60-second bound.

**Independent Test**: Join as 2nd person with the notification opt-in checked and the tab backgrounded; have the 1st person finish; verify a Web Push notification arrives. Repeat with the tab focused; verify sound + vibration fire instead and no OS-level push notification appears.

---

### P1: Get Notified As Heating Time Runs Out ⭐ MVP

**User Story**: As the active employee, I want to be alerted when my 5-minute heating time is up, and again just before the confirm-finish grace period ends, even with the tab backgrounded or closed, so I don't hold up the line without realizing it.

**Why P1**: The heating phase is the other point visitors are likely to step away from the tab (they're waiting on a microwave, not staring at a phone).

**Acceptance Criteria**:

1. WHEN a visitor's active-heating timer reaches 5 minutes elapsed THEN the system SHALL trigger the "heating time ended" notification event.
2. WHEN a visitor's active-heating timer reaches 5 minutes 20 seconds elapsed (10 seconds before the new auto-end) THEN the system SHALL trigger the "confirm-finish time is ending" notification event.
3. Each notification event in this story SHALL follow the same focus-based channel-selection rule as the turn-notification event: sound/vibration WHILE the tab has focus, Web Push WHILE it does not (WHERE a valid subscription exists).
4. The system SHALL extend the active-heating auto-end deadline from 5 minutes 15 seconds to 5 minutes 30 seconds (amends the parent spec's QUEUE-13/14/15/16 bound; `HEATING_WINDOW_MS` 315,000ms → 330,000ms).
5. WHILE the active-heating timer is between 5:00 and 5:30, the system SHALL continue to visually flag that time is almost up (parent spec's existing urgency flag, window widened from 15s to 30s).
6. The "I'm Done" button SHALL remain tappable at any point from 0:00 through 5:30, ending the turn immediately when tapped - unchanged from current behavior.
7. IF the active-heating timer reaches 5 minutes 30 seconds without the visitor tapping "I'm Done" THEN the system SHALL auto-end their turn and advance the next person, per the parent spec's existing timeout behavior with the new 5:30 bound.

**Independent Test**: Start a turn, background the tab, let the timer cross 5:00 and verify a push arrives; let it continue to 5:20 and verify a second, distinct push arrives; let it reach 5:30 and verify auto-end + advance. Repeat focused and verify sound/vibration at the same two checkpoints, no push sent.

---

### P1: Extensible Notification Dispatch ⭐ MVP

**User Story**: As the developer maintaining this system, I want every notification scenario to go through one dispatch interface that picks the delivery channel, so that adding a future scenario never means re-solving "push or sound/vibration?" from scratch.

**Why P1**: Explicitly required (Objective 4) - without this, each of the four scenarios risks duplicating its own focus-detection and channel logic, and a fifth scenario becomes a copy-paste job instead of a one-line addition.

**Acceptance Criteria**:

1. The system SHALL dispatch every notification scenario (turn-ready, heating-ended, confirm-finish-ending, seat-opened) through a single notification-service interface responsible for channel selection.
2. The notification-service interface SHALL select the delivery channel using only the target visitor's current focus state and push-subscription validity as inputs, independent of which scenario triggered the call.
3. WHERE a future notification scenario is added THEN the system SHALL require only a new call site through the existing interface, with no changes to the channel-selection logic itself.

**Independent Test**: Add a throwaway 5th call site (e.g. a manual test trigger) that calls the shared dispatch interface with a new scenario name; verify it correctly resolves to push or sound/vibration per current focus state without touching any existing channel-selection code.

---

### P1: Queue Seats Are Capped at 100 ⭐ MVP

**User Story**: As the system, I want to stop accepting new joins once 100 people are already active or waiting, so that the queue stays within a size that "everyone knows exactly when their turn starts" can actually promise.

**Why P1**: Explicitly required (Objective 3); an unbounded queue also unbounds the wait-time estimate and the eventual notification fan-out.

**Acceptance Criteria**:

1. IF a join is attempted WHILE the combined count of the active entry (0 or 1) plus all waiting entries already equals 100 THEN the system SHALL reject the join.
2. The system SHALL enforce the 100-seat cap atomically with the join mutation, using the same compare-and-swap semantics that already prevent duplicate position assignment, so no burst of concurrent joins can push the count above 100.
3. WHEN a join is rejected for being at the seat cap THEN the system SHALL respond with a distinct "queue full" outcome (not the generic error path) so the client can distinguish it from other join failures.
4. WHEN a visitor's join is rejected for being at the seat cap THEN the client SHALL display a "queue full" screen offering to register for a seat-opened notification, instead of a generic error screen.

**Independent Test**: Fill the queue to 100 (active + waiting) entries, attempt a 101st join, and verify it's rejected with the queue-full outcome and the client renders the queue-full screen rather than a generic error.

---

### P1: Get Notified When a Seat Opens ⭐ MVP

**User Story**: As a visitor turned away by a full queue, I want to opt in to being notified when a seat opens, so that I don't have to keep manually reloading the page to check.

**Why P1**: Explicitly required (Objective 3) - the seat cap is only acceptable to visitors if it comes with a way back in.

**Acceptance Criteria**:

1. WHEN a visitor is shown the queue-full screen THEN the system SHALL offer an opt-in control to register for a seat-opened notification, requesting push permission only as part of that opt-in gesture (same gesture-tied trigger as the Join form's checkbox).
2. WHEN the combined active+waiting count drops below 100 after having been at 100 THEN the system SHALL trigger the seat-opened notification event for every currently registered waitlist subscriber at once.
3. WHILE a waitlisted visitor's tab has focus at the moment the seat-opened event fires, the system SHALL use the sound/vibration channel; WHILE it lacks focus and a valid subscription exists, the system SHALL use Web Push - the same channel-selection rule as the other three scenarios.
4. A seat-opened notification SHALL NOT reserve a seat for any specific waitlisted visitor - the first to complete the normal join flow gets it, and the rest remain waitlisted for the next opening.
5. WHEN a waitlisted visitor successfully joins the queue THEN the system SHALL remove their waitlist registration.
6. The system SHALL allow a visitor to cancel their own waitlist registration, authenticated by the opaque token issued to them at registration time.

**Independent Test**: With the queue at 100, register for the waitlist (tab backgrounded), have one active entry finish, and verify a push arrives; join immediately after and verify the waitlist registration is gone. Register a second waitlist entry, have another seat free up, and verify only that entry (not the already-joined one) gets notified.

---

### P2: Opt Into Notifications From the Join Form

**User Story**: As a visitor joining the queue, I want a clear, unforced choice to enable notifications right when I join, so that I'm not surprised by a permission prompt I didn't ask for.

**Why P2**: A UX refinement of the P1 turn/heating notification stories above - the core notification behavior works without this being its own polished control, but the trigger point matters for not annoying visitors.

**Acceptance Criteria**:

1. The Join form SHALL include an opt-in control for turn/heating notifications, unchecked by default.
2. WHEN a visitor checks the opt-in control and submits the Join form THEN the system SHALL request browser push permission as part of that same submit action - never automatically on page load.
3. IF the visitor denies the permission prompt THEN the system SHALL still complete the join, without a push subscription, and the visitor continues to get the focused-tab sound/vibration channel.

**Independent Test**: Join with the box unchecked and verify no permission prompt appears. Join with it checked and verify the prompt appears at submit time, and that denying it still completes the join successfully.

---

## Edge Cases

- IF the queue count never drops below 100 THEN waitlisted visitors SHALL simply continue to receive no seat-opened notification - registrations have no timeout or expiry.
- IF a visitor's stored push subscription is rejected by the push service as expired or invalid (410/404) THEN the system SHALL discard that subscription rather than retrying it.
- IF a visitor's device does not support the Push API or the Vibration API THEN the system SHALL still complete every existing queue action normally, degrading only the notification channel that depends on the missing API (consistent with the parent spec's existing Vibration API edge case).
- IF a visitor closes the tab entirely after opting into push notifications THEN the system SHALL continue to attempt delivery via the browser's push service exactly as if the tab were merely backgrounded (this is the primary case the Push API/service worker exists to cover).
- WHEN a waitlist registration's push subscription turns out to be invalid at the moment of a seat-opened broadcast THEN the system SHALL drop that one subscriber's delivery without blocking delivery to the rest of the waitlist.

---

## Requirement Traceability

Each requirement gets a unique ID for tracking across design, tasks, and validation.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| NOTIF-01 | P1: Get Notified When It's My Turn | Design | Pending |
| NOTIF-02 | P1: Get Notified When It's My Turn | Design | Pending |
| NOTIF-03 | P1: Get Notified When It's My Turn | Design | Pending |
| NOTIF-04 | P1: Get Notified When It's My Turn | Design | Pending |
| NOTIF-05 | P1: Get Notified When It's My Turn | Design | Pending |
| NOTIF-06 | P1: Get Notified When It's My Turn | Design | Pending |
| NOTIF-07 | P1: Get Notified As Heating Time Runs Out | Design | Pending |
| NOTIF-08 | P1: Get Notified As Heating Time Runs Out | Design | Pending |
| NOTIF-09 | P1: Get Notified As Heating Time Runs Out | Design | Pending |
| NOTIF-10 | P1: Get Notified As Heating Time Runs Out | Design | Pending |
| NOTIF-11 | P1: Get Notified As Heating Time Runs Out | Design | Pending |
| NOTIF-12 | P1: Get Notified As Heating Time Runs Out | Design | Pending |
| NOTIF-13 | P1: Get Notified As Heating Time Runs Out | Design | Pending |
| NOTIF-14 | P1: Extensible Notification Dispatch | Design | Pending |
| NOTIF-15 | P1: Extensible Notification Dispatch | Design | Pending |
| NOTIF-16 | P1: Extensible Notification Dispatch | Design | Pending |
| NOTIF-17 | P1: Queue Seats Are Capped at 100 | Design | Pending |
| NOTIF-18 | P1: Queue Seats Are Capped at 100 | Design | Pending |
| NOTIF-19 | P1: Queue Seats Are Capped at 100 | Design | Pending |
| NOTIF-20 | P1: Queue Seats Are Capped at 100 | Design | Pending |
| NOTIF-21 | P1: Get Notified When a Seat Opens | Design | Pending |
| NOTIF-22 | P1: Get Notified When a Seat Opens | Design | Pending |
| NOTIF-23 | P1: Get Notified When a Seat Opens | Design | Pending |
| NOTIF-24 | P1: Get Notified When a Seat Opens | Design | Pending |
| NOTIF-25 | P1: Get Notified When a Seat Opens | Design | Pending |
| NOTIF-26 | P1: Get Notified When a Seat Opens | Design | Pending |
| NOTIF-27 | P2: Opt Into Notifications From the Join Form | Design | Pending |
| NOTIF-28 | P2: Opt Into Notifications From the Join Form | Design | Pending |
| NOTIF-29 | P2: Opt Into Notifications From the Join Form | Design | Pending |

**ID format:** `NOTIF-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 29 total, 0 mapped to tasks, 29 unmapped ⚠️ (expected pre-Design)

### Amends Existing `lunchbox-queue` Requirements

| Existing ID | Old value | New value | Amended by |
| --- | --- | --- | --- |
| QUEUE-08 / QUEUE-09 | 20-second confirm-turn window | 60-second confirm-turn window | NOTIF-05 |
| QUEUE-13 / QUEUE-14 / QUEUE-15 / QUEUE-16 | 5:15 heating auto-end, 5:00-5:15 urgency flag | 5:30 heating auto-end, 5:00-5:30 urgency flag | NOTIF-10, NOTIF-11 |

---

## Success Criteria

How we know the feature is successful:

- [ ] A visitor with the tab closed still gets a Web Push notification for each of the four scenarios (turn ready, heating ended, confirm-finish ending, seat opened) when opted in.
- [ ] A visitor with the tab focused never receives a redundant OS-level push notification for the same event - only sound/vibration.
- [ ] All four scenarios are implemented as call sites into one shared notification-dispatch interface, with zero scenario-specific channel-selection code.
- [ ] The queue never holds more than 100 active+waiting entries, even under concurrent join attempts at the boundary.
- [ ] A visitor turned away by a full queue can opt in and later get notified without needing to poll/reload manually.
- [ ] No push-subscription or waitlist endpoint accepts a request without the same bearer-session-token verification already used by the existing mutation routes.
