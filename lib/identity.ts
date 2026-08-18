const STORAGE_KEY = "marmiflix.identity";

export interface Identity {
  id: string;
  name: string;
  sessionToken: string;
}

function isIdentity(value: unknown): value is Identity {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Identity).id === "string" &&
    typeof (value as Identity).name === "string" &&
    typeof (value as Identity).sessionToken === "string"
  );
}

export function getIdentity(): Identity | null {
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
    return isIdentity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setIdentity(identity: Identity): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

export function clearIdentity(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
