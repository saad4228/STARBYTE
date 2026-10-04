/**
 * Room codes: 8 characters from an unambiguous 31-letter alphabet (no 0/O, 1/I/L).
 * 31^8 ≈ 8.5 × 10^11 combinations — unguessable at free-tier request rates, yet easy to read aloud.
 */
export const ROOM_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_ID_LENGTH = 8;

const TOKEN_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Uniform random string over `alphabet`, using rejection sampling to avoid modulo bias. */
export function randomString(length: number, alphabet: string = TOKEN_ALPHABET): string {
  const n = alphabet.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit) out += alphabet[b % n];
      if (out.length === length) break;
    }
  }
  return out;
}

export function newRoomId(): string {
  return randomString(ROOM_ID_LENGTH, ROOM_ALPHABET);
}

/** Accepts "4h7k-9xqp", "4H7K9XQP" or a full invite link; returns the canonical id or null. */
export function normalizeRoomId(input: string): string | null {
  let raw = input.trim();
  const fromLink = raw.match(/\/r\/([A-Za-z0-9-]+)/);
  if (fromLink?.[1]) raw = fromLink[1];
  const id = raw.toUpperCase().replace(/[\s-]/g, "");
  if (id.length !== ROOM_ID_LENGTH) return null;
  for (const ch of id) if (!ROOM_ALPHABET.includes(ch)) return null;
  return id;
}

/** "4H7K9XQP" → "4H7K-9XQP" */
export function formatRoomId(id: string): string {
  return id.length === ROOM_ID_LENGTH ? `${id.slice(0, 4)}-${id.slice(4)}` : id;
}
