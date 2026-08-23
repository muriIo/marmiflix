# Queue Notifications & Seat Limit Design

**Spec**: `.specs/features/queue-notifications/spec.md`
**Context**: `.specs/features/queue-notifications/context.md`
**Status**: Draft

---

## Architecture Overview

Two decisions drive everything else here. Both were researched, not assumed (see Tech Decisions for sources), and both conform to `AD-001` (no websockets, no cron/persistent process, single Redis key, CAS writes).

**1. Where channel selection (push vs. sound/vibration) happens: the service worker, not the server.**

The server does not try to track "is this visitor's tab focused right now" - that would mean inventing a heartbeat/presence channel on top of the existing polling loop, and it would always be a few seconds stale. Instead, the server's job is trivial: whenever a scenario fires, push to every subscribed recipient, unconditionally. The **service worker's `push` event handler** is the one place that can check live focus state (`clients.matchAll({type:"window"})` + `WindowClient.focused`, confirmed via MDN/web.dev research below) at the exact moment delivery happens. If a focused window client exists, the SW suppresses `showNotification()` entirely - the focused tab's own existing polling loop already plays the sound/vibration (that code already exists in `ConfirmTurn.tsx`/`Heating.tsx` today and needs no change). If no focused client exists (backgrounded or closed tab), the SW shows the OS notification. This is the "strategy" the spec's NOTIF-14/15/16 requires, just resolved at the point of delivery instead of the point of dispatch - the browser is the only party that can answer "is this focused?" without staleness.

**2. When scenario events are detected: piggybacked onto the existing lazy on-read pattern, not a new scheduler.**

`AD-001` already rejected cron/persistent processes for reaping expired turns. The heating-elapsed checkpoints (5:00, 5:20) have no natural mutation to hang off (nothing in `QueueState` changes at those instants today), so detection is added as a new pure step in the same place `reapExpired` already runs - inside `withQueueMutation`, on every poll and every mutation. This has the same precision bound the realtime-sync spec already accepts (~poll interval), so it's not a new class of imprecision, just an application of the existing one.

```mermaid
sequenceDiagram
    participant Client A (backgrounded)
    participant Route Handler
    participant Store (Redis CAS)
    participant after()
    participant web-push
    participant Push Service
    participant SW (Client A)

    Client A (backgrounded)->>Route Handler: GET /api/queue (poll)
    Route Handler->>Store (Redis CAS): withQueueMutation()
    Store (Redis CAS)->>Store (Redis CAS): reapExpired + applyHeatingCheckpoints
    Store (Redis CAS)-->>Route Handler: {result, notificationJobs}
    Route Handler->>Client A (backgrounded): 200 view JSON (immediate)
    Route Handler->>after(): schedule dispatch (non-blocking)
    after()->>web-push: sendNotification(subscription, payload) per job
    web-push->>Push Service: encrypted push message
    Push Service->>SW (Client A): push event
    SW (Client A)->>SW (Client A): clients.matchAll() -> any focused?
    SW (Client A)->>SW (Client A): no focused client -> showNotification()
```

---

## Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to Use |
| --- | --- | --- |
| `withQueueMutation` / CAS loop | `lib/queue/store.ts` | Extend to run `applyHeatingCheckpoints` alongside `reapExpired`, and to diff before/after state into `notificationJobs` - same retry loop, no new concurrency primitive |
| `authorizeEntry` bearer-token auth | `lib/queue/route-helpers.ts` | Reused verbatim for the new `push-subscribe` route (visitor already has an entry) |
| `hashToken`/`verifyToken`/`generateSessionToken` | `lib/queue/session.ts` | Reused verbatim to mint/verify the waitlist's opaque token (no new crypto written) |
| `checkRateLimit` | `lib/queue/rate-limit.ts` | Reused on every new mutation route (`push-subscribe`, `waitlist/join`, `waitlist/leave`) |
| Route handler error-mapping pattern | `app/api/queue/confirm-turn/route.ts` etc. | New routes follow the identical try/catch → typed-error → status-code shape |
| `lib/identity.ts` localStorage pattern | `lib/identity.ts` | Cloned (not extended, different shape) as `lib/waitlist-identity.ts` for the waitlist's `{id, token}` pair |
| In-tab sound/vibration | `components/queue/ConfirmTurn.tsx`, `Heating.tsx` | Untouched for 3 of 4 scenarios - the "focused" branch already works via existing polling. `QueueFull.tsx` reuses `playTurnChime`/`navigator.vibrate` directly (no hook) for the 4th (`seat-opened`), triggered by the SW's `postMessage` relay instead of polling |

### Integration Points

| System | Integration Method |
| --- | --- |
| Upstash Redis (`queue:state` key) | `QueueState` gains `seatWaitlist: SeatWaitlistEntry[]`; `WaitingEntry`/`ActiveEntry` gain an optional `pushSubscription`; `ActiveEntry` gains `notifiedCheckpoints`. Still one key, still CAS - no schema migration needed since the key is ephemeral and rewritten on every mutation |
| Browser Push API | New `public/sw.js` service worker (static file, no bundler step) registered from the client on Join-form submit or waitlist opt-in |
| `web-push` (new dependency) | Server-only, called from the new `lib/notifications/dispatcher.ts`, configured once via `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` env vars |
| Next.js `after()` (`next/server`, stable since 15.1 - confirmed via research, project is on 15.5.23) | Called at each route handler, right before `return Response.json(...)`, to dispatch notification jobs without adding push-delivery latency to the mutation response |

---

## Components

### `lib/queue/engine.ts` (extended, not replaced)

- **Purpose**: Pure state-transition functions - unchanged responsibility, three additions.
- **Location**: `lib/queue/engine.ts`
- **Interfaces** (new):
  - `applyHeatingCheckpoints(state: QueueState, now: number): { state: QueueState; fired: HeatingCheckpoint[] }` - detects the 5:00/5:20 elapsed-time boundaries, idempotent (checks `notifiedCheckpoints` before adding)
  - `applyAttachPushSubscription(state, input: IdentifiedInput & { subscription: PushSubscriptionRecord }): QueueState` - stores a subscription on the caller's active or waiting entry
  - `applyPruneSubscriptions(state: QueueState, invalidEndpoints: string[]): QueueState` - removes subscriptions/waitlist entries whose `endpoint` came back 404/410 from the push service
- **Constants changed**: `CONFIRM_WINDOW_MS` 20,000 → 60,000; `HEATING_NOMINAL_MS` (new name for the 5:00 mark) = 300,000; `HEATING_URGENCY_MS` (new, replaces the implicit 15s) = 30,000; `HEATING_WINDOW_MS` = `HEATING_NOMINAL_MS + HEATING_URGENCY_MS` = 330,000. New: `MAX_QUEUE_SEATS = 100`.
- **`applyJoin` changes**: throws the new `QueueFullError` when `(active ? 1 : 0) + waiting.length >= MAX_QUEUE_SEATS`, checked before the existing name-validation/duplicate logic finishes (cheapest check first is fine either order - cap check first avoids wasting a duplicate-name Redis round trip on an already-full queue, so it goes first). Accepts an optional `pushSubscription` on `JoinInput`, attached to whichever entry (active or waiting) gets created.
- **Dependencies**: none new (still pure, still only `./types`)
- **Reuses**: existing `promoteNextToActive`, `normalizedName`, `isNameTaken`

### `lib/queue/store.ts` (extended)

- **Purpose**: Redis CAS orchestration - unchanged responsibility, adds notification-job detection as a cross-cutting diff step so `engine.ts` stays free of notification concerns.
- **Location**: `lib/queue/store.ts`
- **Interfaces** (new):
  - `withQueueMutation<T>(mutate): Promise<{ result: T; notificationJobs: NotificationJob[] }>` - return shape changes (was `Promise<T>`); every call site updates to destructure
- **Internal logic added**: after `reapExpired` and before `mutate`, run `applyHeatingCheckpoints`; after `mutate` produces `next`, diff `checkpointed` (before) vs `next` (after) for two job types:
  - **turn-ready**: `next.active?.phase === "confirming"` AND (`checkpointed.active?.id !== next.active.id` OR `checkpointed.active?.phase !== "confirming"`) → one job targeting `next.active.pushSubscription` (skipped entirely if that field is absent - no subscription, no job)
  - **seat-opened**: `(checkpointed.active?1:0)+checkpointed.waiting.length >= 100` AND `(next.active?1:0)+next.waiting.length < 100` → one broadcast job targeting every `next.seatWaitlist[].subscription`
  - plus the `fired` checkpoints from `applyHeatingCheckpoints`, each mapped to a job targeting `next.active?.pushSubscription` (heating-ended / confirm-finish-ending only ever have at most one recipient - the active entry)
- **Dependencies**: `./engine`, `./redis-client`
- **Reuses**: existing CAS loop, retry/backoff logic - entirely unchanged

### `lib/notifications/types.ts` (new)

- **Purpose**: Shared vocabulary for the notification subsystem.
- **Location**: `lib/notifications/types.ts`
- **Interfaces**:
  - `type NotificationScenario = "turn-ready" | "heating-ended" | "confirm-finish-ending" | "seat-opened"`
  - `interface NotificationJob { scenario: NotificationScenario; recipients: PushSubscriptionRecord[] }`
  - `interface PushSubscriptionRecord { endpoint: string; keys: { p256dh: string; auth: string } }` (also exported from `lib/queue/types.ts` for entry storage, re-exported here to keep the notification module self-contained... actually: defined once in `lib/queue/types.ts` since it's stored in `QueueState`; `lib/notifications/types.ts` imports it)
- **Dependencies**: `lib/queue/types.ts` (for `PushSubscriptionRecord`)

### `lib/notifications/strategies.ts` (new - the "strategy" registry)

- **Purpose**: One place mapping each scenario to its pt-BR notification copy. This is the concrete answer to Objective 4's "strategy pattern... knows what the current method of notification is in different scenarios" - each scenario is a registered strategy; adding scenario 5 is adding one entry here, nothing else.
- **Location**: `lib/notifications/strategies.ts`
- **Interfaces**:
  - `buildNotificationPayload(scenario: NotificationScenario): { title: string; body: string }`
- **Dependencies**: `./types`

### `lib/notifications/dispatcher.ts` (new)

- **Purpose**: Sends a `NotificationJob` via `web-push`, in parallel across recipients, tolerating individual failures.
- **Location**: `lib/notifications/dispatcher.ts`
- **Interfaces**:
  - `dispatchNotificationJob(job: NotificationJob): Promise<PushSubscriptionRecord[]>` - returns the subset of recipients whose subscription is now invalid (404/410), for the caller to prune
  - `dispatchAll(jobs: NotificationJob[]): Promise<void>` - runs `dispatchNotificationJob` per job, then calls `pruneInvalidSubscriptions` (below) once with the combined invalid list; swallows/logs delivery errors rather than throwing (a push failure must never surface as a queue-mutation failure - see Error Handling Strategy)
- **Dependencies**: `web-push` (configured once at module load via `webpush.setVapidDetails(...)` from env vars), `./strategies`, `lib/queue/store.ts` (for the prune mutation)
- **Reuses**: nothing new to reuse - this is the one genuinely new piece of infrastructure

### `public/sw.js` (new, plain static file)

- **Purpose**: Receives `push` events, decides (via live `WindowClient.focused` state) whether to show an OS notification, and focuses/opens the app on click.
- **Location**: `public/sw.js`
- **Interfaces**: standard `ServiceWorkerGlobalScope` event listeners (`push`, `notificationclick`) - no custom interface, not imported by anything, registered by URL string
- **Dependencies**: none (vanilla JS, no bundler - Next.js serves `public/` as-is)
- **Design correction found during task breakdown**: for `turn-ready`/`heating-ended`/`confirm-finish-ending`, a focused tab already has its own polling-driven reaction (the existing `ConfirmTurn.tsx`/`Heating.tsx` `useEffect`s fire the moment their own poll observes the phase change - no new code needed). But `seat-opened` has no such equivalent: a visitor on the queue-full/waitlist screen has no queue entry at all, so nothing in the existing polling model ever reacts for them. To cover this without inventing a second detection mechanism, the SW's `push` handler - whenever a focused client exists and it suppresses `showNotification()` - also does `client.postMessage({ scenario, entryId })` to every focused `WindowClient`. This is a no-op for the three scenarios that already self-handle via polling (nothing listens for the message), and it's exactly what `QueueFull.tsx` (below) needs for the fourth.

```js
// public/sw.js (shape, not final code)
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const focused = clientList.filter((c) => c.focused);
      if (focused.length > 0) {
        focused.forEach((c) => c.postMessage(data)); // { scenario, title, body }
        return;
      }
      await self.registration.showNotification(data.title, { body: data.body, tag: data.scenario });
    })(),
  );
});
```

### `lib/notifications/client.ts` (new)

- **Purpose**: Browser-side helper for the two opt-in gestures (Join form checkbox, queue-full waitlist button) to register the SW and request a push subscription.
- **Location**: `lib/notifications/client.ts`
- **Interfaces**:
  - `requestPushSubscription(): Promise<PushSubscriptionRecord | null>` - returns `null` on any unsupported/denied/misconfigured path (never throws - this is an optional enhancement, not a blocking requirement for join/waitlist actions)
- **Dependencies**: browser `Notification`, `navigator.serviceWorker`, `PushManager` (feature-detected, not assumed present)

### `app/api/queue/push-subscribe/route.ts` (new)

- **Purpose**: Attach a push subscription to the caller's existing queue entry.
- **Location**: `app/api/queue/push-subscribe/route.ts`
- **Interfaces**: `POST` - body `{ id, sessionToken, subscription }` → `authorizeEntry` (existing) → `applyAttachPushSubscription` (new) → `{ ok: true }`
- **Reuses**: `authorizeEntry`, `checkRateLimit`, the exact error-mapping shape of `confirm-turn/route.ts`

### `app/api/queue/waitlist/join/route.ts` and `app/api/queue/waitlist/leave/route.ts` (new)

- **Purpose**: Register/cancel a seat-opened notification request for a visitor who isn't in the queue at all (queue was full).
- **Location**: `app/api/queue/waitlist/join/route.ts`, `app/api/queue/waitlist/leave/route.ts`
- **Interfaces**:
  - `join`: `POST { subscription }` → mints `id` + opaque token (`generateSessionToken`/`hashToken`, reused) → appends a `SeatWaitlistEntry` → returns `{ id, token }`
  - `leave`: `POST { id, token }` → verifies token hash (`verifyToken`, reused) → removes the entry → `{ ok: true }`
- **Reuses**: `generateSessionToken`, `hashToken`, `verifyToken`, `checkRateLimit` - zero new auth code

### `components/queue/QueueFull.tsx` (new)

- **Purpose**: Renders when a join attempt comes back with `code: "QUEUE_FULL"`; offers the waitlist opt-in; plays the focused-tab sound/vibration cue itself if a `seat-opened` SW message arrives while mounted (see the `sw.js` correction above - this screen has no queue entry to poll for, so it's the one place that listens for the SW's `postMessage` relay directly instead of relying on existing poll-driven detection).
- **Location**: `components/queue/QueueFull.tsx`
- **Interfaces**: `QueueFull({ onLeaveWaitlist }: { onLeaveWaitlist: () => void })` - internally calls `requestPushSubscription()` + `POST /api/queue/waitlist/join` on opt-in, stores `{id, token}` via `lib/waitlist-identity.ts`, and calls `POST /api/queue/waitlist/leave` + clears storage on cancel
- **Reuses**: same visual language (`bg-char-800`, `rounded-3xl`, ember/amber gradient button) as `ErrorScreen.tsx`/`Landing.tsx`; `playTurnChime` from `lib/sound.ts` and `navigator.vibrate` (same calls `ConfirmTurn.tsx` already makes) for the focused-tab cue

### `lib/waitlist-identity.ts` (new)

- **Purpose**: localStorage persistence for a pending waitlist registration, so it survives a reload of the queue-full screen.
- **Location**: `lib/waitlist-identity.ts`
- **Interfaces**: `getWaitlistIdentity(): { id: string; token: string } | null`, `setWaitlistIdentity(reg)`, `clearWaitlistIdentity()`
- **Reuses**: the exact try/catch-around-`window.localStorage` shape of `lib/identity.ts`, different storage key and shape (not extending `Identity`, which requires a `name`)

### `hooks/useQueue.ts` (extended)

- **Purpose**: Two additions to the existing hook - a subscription-aware `join`, and a way for callers to distinguish the seat-cap rejection from other join failures.
- **Location**: `hooks/useQueue.ts`
- **Interfaces** (changed):
  - `QueueActionError` gains an optional `code?: string`, populated from the response body's `code` field when present (parsed in `callQueueApi`, same place `message` already is)
  - `join(name: string, subscription?: PushSubscriptionRecord): Promise<void>` - forwards `subscription` in the POST body when present, omits the field otherwise
- **Dependencies**: `lib/queue/types.ts` (for `PushSubscriptionRecord`)
- **Reuses**: `callQueueApi`'s existing error-mapping - only the parsed fields grow, the control flow doesn't change

### `components/queue/Landing.tsx` (extended)

- **Purpose**: Adds the opt-in checkbox; on submit with it checked, calls `requestPushSubscription()` before/alongside the existing join call and, if a subscription came back, includes it in the join payload. Catches a `QUEUE_FULL`-coded `QueueActionError` and swaps to rendering `QueueFull` locally.
- **Location**: `components/queue/Landing.tsx`
- **Interfaces**: no new exported interface - internal state + one extra field in the existing join call
- **Note**: the `QueueFull` swap happens as **local component state** inside `Landing`, not a new case in `app/page.tsx`'s `PhaseRouter`. `PhaseRouter` switches on `view.self.phase`, which only exists for visitors who successfully hold a queue entry - a rejected join never gets one, so there's no server-reported phase to route on. Keeping this local avoids threading a phantom phase value through the server's view model for a purely client-side UI state.

---

## Data Models

```typescript
// lib/queue/types.ts (extended)

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type HeatingCheckpoint = "heating-ended" | "confirm-finish-ending";

export interface WaitingEntry {
  id: string;
  name: string;
  sessionTokenHash: string;
  joinedAt: number;
  pushSubscription?: PushSubscriptionRecord; // NEW
}

export interface ActiveEntry {
  id: string;
  name: string;
  sessionTokenHash: string;
  phase: "confirming" | "heating";
  phaseStartedAt: number;
  deadline: number;
  pushSubscription?: PushSubscriptionRecord;      // NEW
  notifiedCheckpoints?: HeatingCheckpoint[];       // NEW - only meaningful while phase === "heating"
}

export interface SeatWaitlistEntry {              // NEW
  id: string;
  tokenHash: string;
  subscription: PushSubscriptionRecord;
  registeredAt: number;
}

export interface QueueState {
  version: number;
  active: ActiveEntry | null;
  waiting: WaitingEntry[];
  seatWaitlist: SeatWaitlistEntry[]; // NEW
}

export class QueueFullError extends Error {       // NEW
  constructor() {
    super("A fila está cheia no momento");
    this.name = "QueueFullError";
  }
}
```

```typescript
// lib/notifications/types.ts (new)

export type NotificationScenario =
  | "turn-ready"
  | "heating-ended"
  | "confirm-finish-ending"
  | "seat-opened";

export interface NotificationJob {
  scenario: NotificationScenario;
  recipients: PushSubscriptionRecord[];
}
```

**Relationships**: `PushSubscriptionRecord` is stored inline on whichever entry it belongs to (`WaitingEntry`, `ActiveEntry`, or `SeatWaitlistEntry`) rather than in a separate collection - it lives and dies with that entry, matching the "no separate cleanup job" decision in `context.md`. `NotificationJob` is a transient, in-memory-only shape (never persisted) produced by `store.ts` and consumed once by `dispatcher.ts`.

---

## Error Handling Strategy

| Error Scenario | Handling | User Impact |
| --- | --- | --- |
| Join attempted at 100/100 | `applyJoin` throws `QueueFullError`; route maps it to `409 { error, code: "QUEUE_FULL" }` | Client renders `QueueFull.tsx` instead of a generic error |
| `web-push.sendNotification` rejects with 404/410 | `dispatcher.ts` catches per-recipient (via `Promise.allSettled`), collects the endpoint, and a follow-up `applyPruneSubscriptions` mutation removes it | None - silent server-side cleanup; visitor still gets the in-tab channel if focused |
| `web-push.sendNotification` rejects with any other status (5xx from the push service, network error) | Logged and dropped - no retry (per spec's Out of Scope: no retry/backoff on push delivery) | Visitor simply doesn't get that one push; not surfaced anywhere, matches the spec's explicit "best-effort" edge case |
| Push permission denied or `PushManager`/`Notification` unsupported | `requestPushSubscription()` resolves `null`; join/waitlist-registration proceeds without a subscription field | Visitor keeps the focused-tab sound/vibration channel; no error shown - this is an accepted degrade, not a failure |
| `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` missing at runtime | `dispatcher.ts` module-level `setVapidDetails` call throws at first use; caught in `dispatchAll` and logged, mutation itself already succeeded and already responded | Queue keeps working with zero notifications delivered - a misconfigured deploy degrades to today's sound/vibration-only behavior, never blocks the queue |
| Two seats free up before a waitlist broadcast for the first one completes | Each mutation computes its own before/after diff independently; both broadcasts fire (each to the then-current `seatWaitlist`) - at worst one extra notification to someone who already saw the first | Harmless - matches the accepted "no de-dup needed" edge case in the spec |

---

## Risks & Concerns

| Concern | Location | Impact | Mitigation |
| --- | --- | --- | --- |
| `Heating.tsx` hardcodes its own `URGENCY_WINDOW_MS = 15_000` separately from `engine.ts`'s `HEATING_WINDOW_MS` - a pre-existing magic-number duplication this feature must touch anyway | `components/queue/Heating.tsx:7` | If only one of the two constants gets updated to the new 30s value, the client-side urgency flag and the server-side auto-end silently drift apart | Task work exports `HEATING_URGENCY_MS` from `lib/queue/engine.ts` and has `Heating.tsx` import it instead of redeclaring it - closes the drift risk while making the planned change, not a new abstraction |
| `withQueueMutation`'s return type is a breaking change (`Promise<T>` → `Promise<{ result: T; notificationJobs: NotificationJob[] }>`) | `lib/queue/store.ts:54`, all 5 call sites under `app/api/queue/*/route.ts` | Every existing route handler needs its destructuring updated or it silently breaks (TypeScript will catch this at compile time, not a runtime risk) | Covered explicitly as its own task; `tsc --noEmit` is the gate, not runtime testing alone |
| `after()`'s request-scoped context (confirmed stable in Next 15.1+, project on 15.5.23) needs to be called from within the route handler's own execution, not deep inside a helper module, to reliably attach to the right request | `app/api/queue/*/route.ts` (new call sites) | Calling `after()` from inside `store.ts` instead of the route handler risks it not being associated with the in-flight request in edge cases | Design places every `after()` call directly in the route handler body, right before the `Response.json(...)` return - `store.ts` only returns data, never calls `after()` itself |
| No existing test coverage for "what happens when Redis briefly returns a slightly stale read during a CAS retry" interacting with the new checkpoint-diff logic | `lib/queue/store.ts` (existing retry loop) | A checkpoint could theoretically fire twice across two different winning CAS attempts if `notifiedCheckpoints` weren't persisted atomically with the fire - it is (same `next` object, same CAS write), so this is a designed-out risk, not a live one, but worth an explicit test | Add a unit test asserting a checkpoint that already fired is never re-included in `fired` on a subsequent call with the same `notifiedCheckpoints` |
| `SeatWaitlistEntry` has no cap and no TTL (per `context.md`'s explicit decision) | `lib/queue/types.ts` (new field) | An abandoned/never-cleared waitlist could grow slowly over the life of the deployment (visitors who registered, then just... never came back, and Redis never expires it since the whole key is rewritten indefinitely) | Explicitly accepted in Discuss/Assumptions as out of scope for this pass; revisit only if it becomes a real issue - not a task in this feature |

> All flagged concerns have a mitigation - either folded into a task below or explicitly accepted as out of scope.

---

## Tech Decisions (only non-obvious ones)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Push transport | `web-push` npm package, VAPID (RFC 8292), server-side only | Standard Node.js Web Push library (confirmed via its README); works against every major browser's push service directly, no third-party account (no FCM); matches the MDN Push API reference the user pointed to |
| Channel selection location | Service worker's `push` handler, via `clients.matchAll()` + `WindowClient.focused` | Confirmed via MDN/web.dev/ServiceWorker Cookbook research - the only place that knows live focus state without staleness; keeps the server dumb (always push if subscribed) |
| Checkpoint/event detection timing | Piggybacked on the existing lazy on-read `withQueueMutation` path (extends `reapExpired`'s pattern) | Conforms to `AD-001` (no cron, no persistent process); reuses the same precision bound (~poll interval) the realtime-sync requirement already accepts |
| Background push delivery | Next.js `after()` (`next/server`), called at the route-handler level | Stable since Next 15.1 (project is on 15.5.23); avoids adding push-delivery latency to the mutation response while still guaranteeing execution on Vercel, unlike an un-awaited fire-and-forget promise which serverless can kill mid-flight |
| Notification-scenario extensibility ("strategy pattern" per Objective 4) | A single `strategies.ts` registry (`NotificationScenario` → payload builder) plus one `dispatchNotificationJob` entry point all four scenarios call through | A future 5th scenario adds one registry entry and one call site producing a `NotificationJob` - zero changes to dispatch, auth, rate-limiting, or channel-selection code |
| Push-endpoint auth | Reuses the existing bearer-session-token pattern (`route-helpers.ts`) for `push-subscribe`; a parallel opaque-token pattern (same hash/verify primitives) for the waitlist, since there's no existing entry to authenticate against | No cookies anywhere in the app → no ambient credential → structurally immune to the CSRF pattern the OWASP cheatsheet targets, without writing a second auth mechanism from scratch |
| Seat-cap check ordering in `applyJoin` | Cap check runs before the name/duplicate checks | Cheapest possible rejection when the queue is already full - no point validating a name that can't get in anyway |
| `QUEUE_FULL` HTTP shape | `409` (like the existing duplicate-name conflict) plus a `code: "QUEUE_FULL"` field to disambiguate | Avoids inventing a nonstandard status code; the client already has to branch on response body for other routes, so one more discriminant field is consistent with the existing pattern rather than a new one |

> **Project-level decision recorded:** This design's two headline choices (SW-side focus detection; lazy on-read event detection instead of a scheduler) are added to `.specs/STATE.md` as `AD-002`, since they set the pattern any future notification-adjacent feature in this app should follow.

---

## Tips

(kept for reference only - not part of the design content)
