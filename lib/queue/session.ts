import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyToken(token: string, storedHash: string): boolean {
  try {
    const candidateHash = Buffer.from(hashToken(token), "hex");
    const expectedHash = Buffer.from(storedHash, "hex");

    if (candidateHash.length !== expectedHash.length) {
      return false;
    }

    return timingSafeEqual(candidateHash, expectedHash);
  } catch {
    return false;
  }
}
