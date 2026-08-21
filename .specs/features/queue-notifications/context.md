# Queue Notifications & Seat Limit Context

**Gathered:** 2026-08-21
**Spec:** `.specs/features/queue-notifications/spec.md`
**Status:** Ready for design

---

## Feature Boundary

Adds a dual-channel attention system to the existing `lunchbox-queue` feature (Web Push when the tab has no focus, sound/vibration when it does) for three timing events plus a fourth "seat freed up" event; widens the confirm-turn and confirm-finish windows; and caps the queue at 100 concurrent entries with an opt-in "notify me" waitlist for latecomers. Delivered as one feature because the notification triggers are defined directly in terms of the new timing windows.

---

## Implementation Decisions

### Confirm-finish flow (heating tail window)

- No new phase. The existing single "heating" phase and its one "I'm Done" button stay exactly as they are today, usable at any point from 0:00 onward.
- Only the tail-grace constant changes: the window during which time is visually flagged as almost-up moves from 5:00–5:15 to 5:00–5:30 (30s grace instead of 15s), and the hard auto-end moves from 5:15 to 5:30.
- Two notification checkpoints fire inside that single phase, keyed off elapsed heating time, not off a phase transition:
  - **T+5:00** (heating time ended) → "5 minutes are up" notification.
  - **T+5:20** (10s before the 5:30 auto-end) → "confirm-finish time is ending" notification.
- Rationale: the user picked the simpler option over introducing a distinct "confirming-finish" phase — one less state to build, test, and keep in sync with the existing engine/state machine, at the cost of the finish confirmation being implicit (auto-end) rather than a distinct explicit button tap. Accepted trade-off.

### Notification permission trigger

- Permission is requested inline, tied to a user gesture, never as a surprise prompt on page load.
- The Join form gets a checkbox (default recommendation: unchecked, opt-in) — e.g. "Avisar mesmo se eu fechar a aba." Checking it and submitting the join is the gesture that triggers the browser's native permission prompt.
- If permission is denied or the box is left unchecked, the visitor still gets the in-tab sound/vibration channel whenever the tab has focus; no push channel is available to them, and that's an accepted degrade, not an error state.
- The full-queue "notify me when a seat opens" screen (Objective 3) gets its own equivalent opt-in gesture, since a person offering to be notified there isn't filling out the Join form at all.

### Full-queue waitlist fairness model

- Broadcast, no reservation: when a seat frees up (queue count drops below 100), every waitlisted subscriber is notified at once.
- Whoever completes the normal Join flow first gets the seat — the existing compare-and-swap join logic in `lib/queue/store.ts`/`engine.ts` already makes concurrent joins race-safe, so no new reservation or hold-timer subsystem is needed.
- Anyone not fast enough stays on the waitlist for the next opening (no removal, no penalty).
- Rationale: consistent with the existing queue's "no reservations, first successful mutation wins" philosophy (`AD-001`); avoids building a second timeout/expiry subsystem parallel to the confirm-turn one.

### Agent's Discretion

- Web Push transport: VAPID-authenticated Web Push (RFC 8292) via a server-side `web-push`-style library, triggered from serverless route handlers — no third-party push service (e.g. FCM) introduced, since VAPID Web Push works directly against every major browser's push service and needs no extra account/infrastructure. Payload encryption is the browser push service's job per the Push API spec, not something hand-rolled.
- Push-subscription endpoint auth: follows the exact pattern already used by `confirm-turn`/`finish`/`leave` (`lib/queue/route-helpers.ts`) — a bearer session token in the JSON body, verified server-side by constant-time hash comparison, no cookies involved. Because there is no ambient credential (no cookie), the app is already structurally immune to the classic CSRF pattern the OWASP cheatsheet warns about; the new endpoints inherit that property by reusing the same scheme rather than introducing cookie-based auth.
- For the full-queue waitlist (no existing queue entry to piggyback auth on), a lightweight opaque token is minted and returned to the client at notify-request time, hashed server-side the same way session tokens are, so only the original requester can cancel their own waitlist registration.
- Subscription storage/lifecycle: a push subscription lives alongside the queue entry it belongs to and is discarded whenever that entry is (leave, confirm-turn timeout, finish, or full-queue waitlist entry consumed by a successful join). No separate cleanup job.
- Rate limiting on new endpoints reuses the existing `lib/queue/rate-limit.ts` helper, same as every other mutation route.
- Waitlist has no separate size cap beyond the 100-seat cap already implied by the shrinking pool of "still full" time (i.e., it can hold more than 100 - not gated further); revisit if it ever becomes a real scaling concern.

---

## Specific References

- User pointed to MDN's Push API docs, the OWASP CSRF Prevention Cheat Sheet, Jeff Atwood's CSRF/XSRF article, and a Medium walkthrough of adding Web Push to a web app - all treated as the baseline for "do this the standard, non-cut-corners way," not as literal implementation instructions to follow line-by-line.
- User explicitly framed the security bar as non-negotiable given this handles push subscriptions (real endpoints/keys tied to real devices).
- Notification architecture must be extensible - a strategy-pattern-style notification service where the concrete channel (push vs. sound/vibration) is selected by current context (document focus/visibility), reusable across all four notification scenarios and future ones.

---

## Deferred Ideas

None - discussion stayed within feature scope. (Multi-device push per visitor, admin visibility into the waitlist, and waitlist size caps were named as explicitly out of scope / not needed now, not deferred features to build later.)
