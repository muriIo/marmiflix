// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearWaitlistIdentity,
  getWaitlistIdentity,
  setWaitlistIdentity,
} from "../waitlist-identity";

describe("waitlist identity storage (NOTIF-25, NOTIF-26)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when nothing has been stored", () => {
    expect(getWaitlistIdentity()).toBeNull();
  });

  it("round-trips a waitlist identity through set then get", () => {
    setWaitlistIdentity({ id: "wl-123", token: "tok-abc" });

    expect(getWaitlistIdentity()).toEqual({ id: "wl-123", token: "tok-abc" });
  });

  it("removes the stored waitlist identity on clear", () => {
    setWaitlistIdentity({ id: "wl-123", token: "tok-abc" });
    clearWaitlistIdentity();

    expect(getWaitlistIdentity()).toBeNull();
  });

  it("returns null (not a throw) on corrupt/malformed stored JSON", () => {
    window.localStorage.setItem("marmiflix.waitlist-identity", "{not valid json");

    expect(() => getWaitlistIdentity()).not.toThrow();
    expect(getWaitlistIdentity()).toBeNull();
  });

  it("returns null (not a throw) when stored JSON is valid but missing required fields", () => {
    window.localStorage.setItem("marmiflix.waitlist-identity", JSON.stringify({ id: "wl-123" }));

    expect(getWaitlistIdentity()).toBeNull();
  });

  it("uses a storage key distinct from the queue identity's key", () => {
    setWaitlistIdentity({ id: "wl-123", token: "tok-abc" });

    expect(window.localStorage.getItem("marmiflix.identity")).toBeNull();
    expect(window.localStorage.getItem("marmiflix.waitlist-identity")).not.toBeNull();
  });
});
