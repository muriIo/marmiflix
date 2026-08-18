// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQueue } from "../useQueue";

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
