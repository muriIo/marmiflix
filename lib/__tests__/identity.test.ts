// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearIdentity, getIdentity, setIdentity } from "../identity";

describe("identity storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when nothing has been stored (QUEUE-07 groundwork)", () => {
    expect(getIdentity()).toBeNull();
  });

  it("round-trips an identity through set then get", () => {
    setIdentity({ id: "abc-123", name: "Ana", sessionToken: "tok-xyz" });

    expect(getIdentity()).toEqual({ id: "abc-123", name: "Ana", sessionToken: "tok-xyz" });
  });

  it("removes the stored identity on clear", () => {
    setIdentity({ id: "abc-123", name: "Ana", sessionToken: "tok-xyz" });
    clearIdentity();

    expect(getIdentity()).toBeNull();
  });

  it("returns null (not a throw) on corrupt/malformed stored JSON", () => {
    window.localStorage.setItem("marmiflix.identity", "{not valid json");

    expect(() => getIdentity()).not.toThrow();
    expect(getIdentity()).toBeNull();
  });

  it("returns null (not a throw) when stored JSON is valid but missing required fields", () => {
    window.localStorage.setItem("marmiflix.identity", JSON.stringify({ id: "abc-123" }));

    expect(getIdentity()).toBeNull();
  });
});
