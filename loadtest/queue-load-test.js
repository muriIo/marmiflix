// k6 load test for the lunchbox queue.
//
// This targets concurrency on the shared `queue:state` Redis key, not raw
// throughput: GET /api/queue is polled by every open tab every 2s (see
// POLL_INTERVAL_MS in hooks/useQueue.ts) and, despite being a "read", it
// goes through the same optimistic-CAS write path as join/leave/confirm-turn
// /finish (see withQueueMutation in lib/queue/store.ts). With only 5 CAS
// retries before an uncaught QueueBusyError (-> 500), a handful of real
// users can be enough to trigger contention.
//
// Usage (against a local repro - see README section below):
//   k6 run loadtest/queue-load-test.js
//   k6 run -e BASE_URL=http://localhost:3000 loadtest/queue-load-test.js
//   k6 run -e MAX_VUS=30 loadtest/queue-load-test.js

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const MAX_VUS = Number(__ENV.MAX_VUS || 20);

const serverErrors = new Counter("server_errors_5xx");
const rateLimited = new Counter("rate_limited_429");
const pollFailures = new Rate("poll_failures");
const actionFailures = new Rate("action_failures");

export const options = {
  scenarios: {
    lunch_rush: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: Math.min(5, MAX_VUS) },
        { duration: "1m", target: Math.min(10, MAX_VUS) },
        { duration: "1m", target: MAX_VUS },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    poll_failures: ["rate<0.01"],
    action_failures: ["rate<0.01"],
    server_errors_5xx: ["count<1"],
  },
};

function jsonHeaders() {
  return { headers: { "content-type": "application/json" } };
}

function noteStatus(res) {
  if (res.status >= 500) serverErrors.add(1);
  if (res.status === 429) rateLimited.add(1);
}

function poll(id) {
  const url = id ? `${BASE_URL}/api/queue?id=${id}` : `${BASE_URL}/api/queue`;
  const res = http.get(url, { tags: { name: "poll" } });
  noteStatus(res);
  const ok = check(res, { "poll status 200": (r) => r.status === 200 });
  pollFailures.add(!ok);
  return ok ? res.json() : null;
}

function post(path, body) {
  const res = http.post(`${BASE_URL}${path}`, JSON.stringify(body), jsonHeaders());
  noteStatus(res);
  return res;
}

// One iteration = one person's full lunchbox session: join, poll every 2s
// (matching the real client), confirm when it's their turn, heat, finish -
// or occasionally give up and leave while waiting, same as real users would.
function lunchboxSession() {
  const name = `loadtest-${__VU}-${__ITER}-${Math.floor(Math.random() * 1e6)}`;

  const joinRes = post("/api/queue/join", { name });
  const joinOk = check(joinRes, { "join status 200": (r) => r.status === 200 });
  actionFailures.add(!joinOk);
  if (!joinOk) {
    sleep(2);
    return;
  }
  const { id, sessionToken } = joinRes.json();

  let confirmed = false;
  for (let i = 0; i < 90; i++) {
    sleep(2);
    const view = poll(id);
    if (!view || !view.self) {
      break; // entry is gone (finished, left, or reaped)
    }

    const phase = view.self.phase;
    if (phase === "confirming" && !confirmed) {
      const res = post("/api/queue/confirm-turn", { id, sessionToken });
      actionFailures.add(!check(res, { "confirm-turn ok": (r) => r.status === 200 }));
      confirmed = true;
    } else if (phase === "heating") {
      if (Math.random() < 0.3) {
        const res = post("/api/queue/finish", { id, sessionToken });
        actionFailures.add(!check(res, { "finish ok": (r) => r.status === 200 }));
        break;
      }
    } else if (phase === "waiting" && Math.random() < 0.03) {
      const res = post("/api/queue/leave", { id, sessionToken });
      actionFailures.add(!check(res, { "leave ok": (r) => r.status === 200 }));
      break;
    }
  }
}

export default lunchboxSession;
