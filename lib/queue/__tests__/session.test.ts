import { describe, expect, it } from "vitest";
import { generateSessionToken, hashToken, verifyToken } from "../session";

describe("generateSessionToken", () => {
  it("returns a base64url string decoding to 32 bytes (256 bits) of entropy", () => {
    const token = generateSessionToken();
    const decoded = Buffer.from(token, "base64url");
    expect(decoded.length).toBe(32);
  });

  it("returns a different token on every call", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
  });
});

describe("hashToken", () => {
  it("returns the sha256 hex digest of the token", () => {
    const hash = hashToken("my-secret-token");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    expect(hashToken("same-input")).toBe(hashToken("same-input"));
  });
});

describe("verifyToken", () => {
  it("returns true when the token matches the stored hash", () => {
    const token = generateSessionToken();
    const storedHash = hashToken(token);
    expect(verifyToken(token, storedHash)).toBe(true);
  });

  it("returns false when the token does not match the stored hash", () => {
    const correctToken = generateSessionToken();
    const wrongToken = generateSessionToken();
    const storedHash = hashToken(correctToken);
    expect(verifyToken(wrongToken, storedHash)).toBe(false);
  });

  it("returns false (does not throw) when storedHash is an empty string", () => {
    const token = generateSessionToken();
    expect(() => verifyToken(token, "")).not.toThrow();
    expect(verifyToken(token, "")).toBe(false);
  });

  it("returns false (does not throw) when storedHash has malformed/non-hex content", () => {
    const token = generateSessionToken();
    expect(() => verifyToken(token, "not-valid-hex-!!!")).not.toThrow();
    expect(verifyToken(token, "not-valid-hex-!!!")).toBe(false);
  });

  it("returns false (does not throw) when storedHash is a shorter valid-hex string (length mismatch)", () => {
    const token = generateSessionToken();
    const shortHash = hashToken(token).slice(0, 10);
    expect(() => verifyToken(token, shortHash)).not.toThrow();
    expect(verifyToken(token, shortHash)).toBe(false);
  });
});
