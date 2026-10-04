/**
 * Lightweight identity without accounts.
 *
 * - display name: localStorage (remembered across rooms)
 * - host key: localStorage per room (proves you created it)
 * - participant id + secret: sessionStorage per room, so a refresh rejoins as the same person
 *   while a new tab is a new viewer (handy for testing with two tabs)
 *
 * Storage can be unavailable (private mode, blocked site data); everything degrades gracefully.
 */

function get(store: () => Storage, key: string): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

function set(store: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
  } catch {
    // Storage unavailable — the session still works, it just won't be remembered.
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

export function loadName(): string {
  return get(local, "starbyte:name") ?? "";
}

export function saveName(name: string): void {
  set(local, "starbyte:name", name);
}

export function loadHostKey(roomId: string): string | null {
  return get(local, `starbyte:host:${roomId}`);
}

export function saveHostKey(roomId: string, key: string): void {
  set(local, `starbyte:host:${roomId}`, key);
}

export function loadIdentity(roomId: string): { pid: string; secret: string } | null {
  const raw = get(session, `starbyte:id:${roomId}`);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { pid?: unknown; secret?: unknown };
    return typeof v.pid === "string" && typeof v.secret === "string" ? { pid: v.pid, secret: v.secret } : null;
  } catch {
    return null;
  }
}

export function saveIdentity(roomId: string, pid: string, secret: string): void {
  set(session, `starbyte:id:${roomId}`, JSON.stringify({ pid, secret }));
}

export function forgetIdentity(roomId: string): void {
  set(session, `starbyte:id:${roomId}`, null);
}

const ADJECTIVES = ["Velvet", "Lunar", "Neon", "Quiet", "Pixel", "Cosmic", "Midnight", "Static", "Golden", "Violet"];
const NOUNS = ["Comet", "Moth", "Owl", "Reel", "Signal", "Nova", "Fox", "Popcorn", "Orbit", "Ticket"];

export function suggestName(): string {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)]!;
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}
