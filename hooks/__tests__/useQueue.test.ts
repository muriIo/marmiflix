// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getIdentity, setIdentity } from "../../lib/identity";
import { QueueActionError, useQueue } from "../useQueue";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function baseView(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    queueCount: 0,
    estimatedWaitMs: 0,
    namesAhead: [],
    self: null,
    serverTime: Date.now(),
    ...overrides,
  };
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
}

async function renderAndFlush() {
  const rendered = renderHook(() => useQueue());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return rendered;
}

describe("useQueue polling core (QUEUE-18)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDocumentHidden(false);
    window.localStorage.clear();
  });

  afterEach(() => {
    // Unmount while fake timers are still installed, so each interval's
    // cleanup (clearInterval) runs against the same fake-timer instance that
    // scheduled it - otherwise a prior test's still-mounted hook keeps
    // polling and inflates the next test's call count.
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls GET /api/queue immediately and then every 2000ms", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseView()));
    vi.stubGlobal("fetch", fetchMock);

    await renderAndFlush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    expect(fetchMock).toHaveBeenCalledWith("/api/queue");
  });

  it("includes the stored visitor id as a query param when an identity exists", async () => {
    window.localStorage.setItem(
      "marmiflix.identity",
      JSON.stringify({ id: "visitor-1", name: "Ana", sessionToken: "tok" }),
    );
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseView()));
    vi.stubGlobal("fetch", fetchMock);

    await renderAndFlush();

    expect(fetchMock).toHaveBeenCalledWith("/api/queue?id=visitor-1");
  });

  it("stops polling while the tab is hidden", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseView()));
    vi.stubGlobal("fetch", fetchMock);

    await renderAndFlush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resumes with an immediate poll when visibility is regained", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseView()));
    vi.stubGlobal("fetch", fetchMock);

    await renderAndFlush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("computes now() from the server-clock offset, not the raw client clock", async () => {
    const clientNow = Date.now();
    const skewMs = 5 * 60 * 1000; // server clock is 5 minutes ahead
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(baseView({ serverTime: clientNow + skewMs })));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = await renderAndFlush();

    expect(result.current.view).not.toBeNull();
    const estimated = result.current.now();
    expect(estimated).toBeGreaterThanOrEqual(clientNow + skewMs);
    expect(estimated).toBeLessThan(clientNow + skewMs + 1000);
  });
});

function jsonError(status: number, message: string, code?: string): Response {
  return new Response(JSON.stringify(code ? { error: message, code } : { error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface ActionHandlers {
  join?: () => Response;
  leave?: () => Response | Promise<Response>;
  confirmTurn?: () => Response | Promise<Response>;
  finish?: () => Response | Promise<Response>;
}

function createFetchMock(handlers: ActionHandlers = {}) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    const method = init?.method ?? "GET";

    if (method === "GET") {
      return jsonResponse(baseView());
    }
    if (url.endsWith("/api/queue/join")) {
      return (handlers.join ?? (() => jsonResponse({ id: "v1", sessionToken: "tok", view: baseView() })))();
    }
    if (url.endsWith("/api/queue/leave")) {
      return (handlers.leave ?? (() => jsonResponse({ ok: true })))();
    }
    if (url.endsWith("/api/queue/confirm-turn")) {
      return (handlers.confirmTurn ?? (() => jsonResponse({ ok: true })))();
    }
    if (url.endsWith("/api/queue/finish")) {
      return (handlers.finish ?? (() => jsonResponse({ ok: true })))();
    }
    throw new Error(`unhandled fetch in test: ${method} ${url}`);
  });
}

// `expect(act(...)).rejects` does not reliably surface the settled state of
// synchronous side effects (like clearIdentity()) that ran inside the
// rejected callback by the time the assertion after it runs, under React 19's
// async act() - capturing the error inside the same act() call and asserting
// on it there sidesteps that ordering hazard.
async function captureError(action: () => Promise<unknown>): Promise<unknown> {
  let caught: unknown;
  await act(async () => {
    try {
      await action();
    } catch (error) {
      caught = error;
    }
  });
  return caught;
}

describe("useQueue actions (QUEUE-02/03/06/10/14)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDocumentHidden(false);
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("join() stores the returned id/sessionToken via setIdentity on the happy path", async () => {
    const fetchMock = createFetchMock({
      join: () => jsonResponse({ id: "visitor-1", sessionToken: "tok-1", view: baseView() }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await renderAndFlush();

    await act(async () => {
      await result.current.actions.join("Ana");
    });

    expect(getIdentity()).toEqual({ id: "visitor-1", name: "Ana", sessionToken: "tok-1" });
  });

  it("join() throws a QueueActionError on a duplicate-name 409 and does not store identity", async () => {
    const fetchMock = createFetchMock({
      join: () => jsonError(409, 'Esse nome já está na fila: "Ana"'),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await renderAndFlush();

    const error = await captureError(() => result.current.actions.join("Ana"));

    expect(error).toMatchObject({ status: 409, message: 'Esse nome já está na fila: "Ana"' });
    expect(getIdentity()).toBeNull();
  });

  it("leave() sends the stored identity's id/sessionToken to the leave route", async () => {
    setIdentity({ id: "visitor-1", name: "Ana", sessionToken: "tok-1" });
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await renderAndFlush();

    await act(async () => {
      await result.current.actions.leave();
    });

    const leaveCall = fetchMock.mock.calls.find(([url]) => url.toString().endsWith("/leave"));
    expect(leaveCall).toBeDefined();
    const [, init] = leaveCall as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ id: "visitor-1", sessionToken: "tok-1" });
  });

  it("does nothing and does not call fetch when there is no stored identity", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await renderAndFlush();
    fetchMock.mockClear();

    await act(async () => {
      await result.current.actions.leave();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a 404 (entry already gone) clears local identity", async () => {
    setIdentity({ id: "visitor-1", name: "Ana", sessionToken: "tok-1" });
    const fetchMock = createFetchMock({ leave: () => jsonError(404, "Entrada não encontrada") });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await renderAndFlush();

    const error = await captureError(() => result.current.actions.leave());

    expect(error).toBeInstanceOf(QueueActionError);
    expect(getIdentity()).toBeNull();
  });

  it("a 403 (session token mismatch) clears local identity", async () => {
    setIdentity({ id: "visitor-1", name: "Ana", sessionToken: "tok-1" });
    const fetchMock = createFetchMock({ finish: () => jsonError(403, "Sessão inválida") });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await renderAndFlush();

    const error = await captureError(() => result.current.actions.finish());

    expect(error).toMatchObject({ status: 403 });
    expect(getIdentity()).toBeNull();
  });

  it("a 409 (wrong phase) does NOT clear identity - the entry is still theirs, just out of sync", async () => {
    setIdentity({ id: "visitor-1", name: "Ana", sessionToken: "tok-1" });
    const fetchMock = createFetchMock({
      confirmTurn: () => jsonError(409, "Não é o momento certo"),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await renderAndFlush();

    const error = await captureError(() => result.current.actions.confirmTurn());

    expect(error).toMatchObject({ status: 409 });
    expect(getIdentity()).toEqual({ id: "visitor-1", name: "Ana", sessionToken: "tok-1" });
  });

  it("a transport failure rejects with an error that is NOT a QueueActionError, and does not clear identity", async () => {
    setIdentity({ id: "visitor-1", name: "Ana", sessionToken: "tok-1" });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return jsonResponse(baseView());
      }
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await renderAndFlush();

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.actions.finish();
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(TypeError);
    expect(caught).not.toBeInstanceOf(QueueActionError);
    expect(getIdentity()).toEqual({ id: "visitor-1", name: "Ana", sessionToken: "tok-1" });
  });
});

describe("useQueue join subscription and error codes (NOTIF-19, NOTIF-20, NOTIF-27)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDocumentHidden(false);
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a 409 with {error, code: 'QUEUE_FULL'} produces a QueueActionError with .code === 'QUEUE_FULL'", async () => {
    const fetchMock = createFetchMock({
      join: () => jsonError(409, "A fila está cheia no momento", "QUEUE_FULL"),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await renderAndFlush();

    const error = await captureError(() => result.current.actions.join("Ana"));

    expect(error).toBeInstanceOf(QueueActionError);
    expect((error as QueueActionError).code).toBe("QUEUE_FULL");
  });

  it("a 409 with no code field produces a QueueActionError with .code === undefined (duplicate-name unaffected)", async () => {
    const fetchMock = createFetchMock({
      join: () => jsonError(409, 'Esse nome já está na fila: "Ana"'),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await renderAndFlush();

    const error = await captureError(() => result.current.actions.join("Ana"));

    expect(error).toBeInstanceOf(QueueActionError);
    expect((error as QueueActionError).code).toBeUndefined();
  });

  it("join(name) with no subscription sends a body without a subscription field", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await renderAndFlush();

    await act(async () => {
      await result.current.actions.join("Ana");
    });

    const joinCall = fetchMock.mock.calls.find(([url]) => url.toString().endsWith("/join"));
    expect(joinCall).toBeDefined();
    const [, init] = joinCall as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ name: "Ana" });
  });

  it("join(name, subscription) sends a body including the subscription", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await renderAndFlush();
    const subscription = {
      endpoint: "https://push.example/abc123",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    };

    await act(async () => {
      await result.current.actions.join("Ana", subscription);
    });

    const joinCall = fetchMock.mock.calls.find(([url]) => url.toString().endsWith("/join"));
    expect(joinCall).toBeDefined();
    const [, init] = joinCall as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ name: "Ana", subscription });
  });
});

describe("useQueue network-health signal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDocumentHidden(false);
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries at exactly 2s -> 4s -> 8s -> 16s -> 30s (capped) on sustained transport failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await renderAndFlush(); // attempt #1 (fails)
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    }); // #2, delay after failure #1
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    }); // #3, delay after failure #2
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    }); // #4, delay after failure #3
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    }); // #5, delay after failure #4
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    }); // #6, delay after failure #5 (cap reached)
    expect(fetchMock).toHaveBeenCalledTimes(6);

    // Prove the cap holds exactly at 30s, not "eventually": one tick short does nothing yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("flips connection to 'down' exactly at the 4th consecutive transport failure, staying 'ok' before that", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = await renderAndFlush(); // failure #1
    expect(result.current.connection).toBe("ok");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    }); // failure #2
    expect(result.current.connection).toBe("ok");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    }); // failure #3
    expect(result.current.connection).toBe("ok");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    }); // failure #4
    expect(result.current.connection).toBe("down");
  });

  it("a domain error (429 rate-limited) from an action does NOT count toward the down threshold", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return jsonResponse(baseView());
      }
      return jsonError(429, "Muitas tentativas");
    });
    vi.stubGlobal("fetch", fetchMock);
    setIdentity({ id: "visitor-1", name: "Ana", sessionToken: "tok-1" });
    const { result } = await renderAndFlush();

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await result.current.actions.leave().catch(() => {});
      });
    }

    expect(result.current.connection).toBe("ok");
  });

  it("connection recovers to 'ok' automatically on the next successful poll", async () => {
    let shouldFail = true;
    const fetchMock = vi.fn(async () => {
      if (shouldFail) {
        throw new TypeError("network down");
      }
      return jsonResponse(baseView());
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = await renderAndFlush(); // failure #1
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    }); // failure #2
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    }); // failure #3
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    }); // failure #4 -> down
    expect(result.current.connection).toBe("down");

    shouldFail = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    }); // next attempt succeeds
    expect(result.current.connection).toBe("ok");
  });

  it("retryNow() triggers an immediate attempt, bypassing the remaining backoff wait", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = await renderAndFlush(); // failure #1, next retry scheduled in 2000ms
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.retryNow();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
