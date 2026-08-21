const STORAGE_KEY = "marmiflix.waitlist-identity";

export interface WaitlistIdentity {
  id: string;
  token: string;
}

function isWaitlistIdentity(value: unknown): value is WaitlistIdentity {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as WaitlistIdentity).id === "string" &&
    typeof (value as WaitlistIdentity).token === "string"
  );
}

export function getWaitlistIdentity(): WaitlistIdentity | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isWaitlistIdentity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setWaitlistIdentity(identity: WaitlistIdentity): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

export function clearWaitlistIdentity(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
