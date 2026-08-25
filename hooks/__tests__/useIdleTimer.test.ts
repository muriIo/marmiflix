// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdleTimer } from "../useIdleTimer";

const TIMEOUT_MS = 180_000;

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
}

describe("useIdleTimer (IDLE-01/02/05)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDocumentHidden(false);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not call onIdle before the timeout elapses", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeoutMs: TIMEOUT_MS, enabled: true, onIdle }));

    vi.advanceTimersByTime(TIMEOUT_MS - 1);

    expect(onIdle).not.toHaveBeenCalled();
  });

  it("calls onIdle once 180s elapse with no qualifying activity", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeoutMs: TIMEOUT_MS, enabled: true, onIdle }));

    vi.advanceTimersByTime(TIMEOUT_MS);

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it.each(ACTIVITY_EVENT_NAMES())(
    "resets the idle timer on a qualifying '%s' event",
    (eventName) => {
      const onIdle = vi.fn();
      renderHook(() => useIdleTimer({ timeoutMs: TIMEOUT_MS, enabled: true, onIdle }));

      vi.advanceTimersByTime(TIMEOUT_MS - 1000);
      window.dispatchEvent(new Event(eventName));
      vi.advanceTimersByTime(TIMEOUT_MS - 1000);
      expect(onIdle).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(onIdle).toHaveBeenCalledTimes(1);
    },
  );

  it("does not reset the idle timer while the tab is hidden", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeoutMs: TIMEOUT_MS, enabled: true, onIdle }));

    vi.advanceTimersByTime(TIMEOUT_MS - 1000);
    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));

    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("resets the idle timer when the tab regains visibility", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeoutMs: TIMEOUT_MS, enabled: true, onIdle }));

    vi.advanceTimersByTime(TIMEOUT_MS - 1000);
    setDocumentHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(TIMEOUT_MS - 1000);

    expect(onIdle).not.toHaveBeenCalled();
  });

  it("never calls onIdle while enabled is false", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeoutMs: TIMEOUT_MS, enabled: false, onIdle }));

    vi.advanceTimersByTime(TIMEOUT_MS * 5);

    expect(onIdle).not.toHaveBeenCalled();
  });

  it("stops a pending idle timer when enabled flips from true to false", () => {
    const onIdle = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useIdleTimer({ timeoutMs: TIMEOUT_MS, enabled, onIdle }),
      { initialProps: { enabled: true } },
    );

    vi.advanceTimersByTime(TIMEOUT_MS - 1000);
    rerender({ enabled: false });
    vi.advanceTimersByTime(TIMEOUT_MS * 5);

    expect(onIdle).not.toHaveBeenCalled();
  });
});

function ACTIVITY_EVENT_NAMES(): string[] {
  return ["mousemove", "keydown", "click", "touchstart", "scroll"];
}
