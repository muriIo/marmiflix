"use client";

import { useEffect, useRef } from "react";

// The qualifying activity signals from IDLE-01 (mouse/keyboard/touch/scroll);
// tab-regains-visibility is handled separately via visibilitychange below.
const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "touchstart", "scroll"] as const;

export interface UseIdleTimerOptions {
  /** Milliseconds of no qualifying activity before onIdle fires. */
  timeoutMs: number;
  /** When false, the timer is torn down entirely and onIdle never fires. */
  enabled: boolean;
  onIdle: () => void;
}

export function useIdleTimer({ timeoutMs, enabled, onIdle }: UseIdleTimerOptions): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const resetTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => onIdleRef.current(), timeoutMs);
    };

    // A tab regaining visibility counts as qualifying activity (IDLE-01);
    // going hidden does not reset anything on its own.
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        resetTimer();
      }
    };

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, resetTimer, { passive: true });
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    resetTimer();

    return () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, resetTimer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, timeoutMs]);
}
