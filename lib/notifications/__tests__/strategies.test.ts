import { describe, expect, it } from "vitest";
import { buildNotificationPayload } from "../strategies";
import type { NotificationScenario } from "../types";

const SCENARIOS: NotificationScenario[] = [
  "turn-ready",
  "heating-ended",
  "confirm-finish-ending",
  "seat-opened",
];

describe("buildNotificationPayload", () => {
  it.each(SCENARIOS)(
    "returns a non-empty title and body for the %s scenario (NOTIF-14, NOTIF-16)",
    (scenario) => {
      const payload = buildNotificationPayload(scenario);

      expect(typeof payload.title).toBe("string");
      expect(payload.title.length).toBeGreaterThan(0);
      expect(typeof payload.body).toBe("string");
      expect(payload.body.length).toBeGreaterThan(0);
    },
  );

  it("returns distinct title copy across all four scenarios (NOTIF-14)", () => {
    const titles = SCENARIOS.map((scenario) => buildNotificationPayload(scenario).title);

    expect(new Set(titles).size).toBe(SCENARIOS.length);
  });
});
