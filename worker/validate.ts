import { LIMITS, PLAYBACK_RATES } from "../shared/constants";
import { cleanText } from "../shared/format";
import type { ClientMessage, MediaFingerprint, RoomSettings, SyncStatus } from "../shared/protocol";

/**
 * Strict parsing for everything a client sends. Anything that does not match the expected
 * shape is dropped — the room never trusts client payloads, permissions or timestamps.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const HEX = /^[0-9a-f]{8,64}$/;
const SYNC_STATUSES: ReadonlySet<string> = new Set(["idle", "synced", "catching_up", "buffering", "mismatch"]);
const RATES: readonly number[] = PLAYBACK_RATES;

function actionId(v: unknown): string | undefined {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(v) ? v : undefined;
}

function token(v: unknown, min: number, max: number): string | undefined {
  return typeof v === "string" && v.length >= min && v.length <= max && /^[A-Za-z0-9]+$/.test(v)
    ? v
    : undefined;
}

export function parseFingerprint(v: unknown): MediaFingerprint | null {
  if (!isObj(v)) return null;
  const name = cleanText(v.name, 160);
  if (!name) return null;
  if (!isNum(v.size) || v.size < 0 || v.size > Number.MAX_SAFE_INTEGER) return null;
  if (!isNum(v.duration) || v.duration <= 0 || v.duration > 7 * 24 * 3600) return null;
  if (typeof v.sampleHash !== "string" || !HEX.test(v.sampleHash)) return null;

  const dim = (x: unknown) => (isNum(x) ? Math.max(0, Math.min(16384, Math.round(x))) : 0);
  const fp: MediaFingerprint = {
    name,
    size: Math.round(v.size),
    duration: v.duration,
    mime: cleanText(v.mime, 80),
    width: dim(v.width),
    height: dim(v.height),
    sampleHash: v.sampleHash,
  };
  if (typeof v.fullHash === "string" && HEX.test(v.fullHash)) fp.fullHash = v.fullHash;
  const videoCodec = cleanText(v.videoCodec, 32);
  if (videoCodec) fp.videoCodec = videoCodec;
  if (Array.isArray(v.audioCodecs)) {
    const audio = v.audioCodecs.slice(0, 8).map((a) => cleanText(a, 32)).filter(Boolean);
    if (audio.length) fp.audioCodecs = audio;
  }
  return fp;
}

/**
 * Only absolute https URLs. The room never fetches these itself, but it does hand them to every
 * other viewer's browser, so anything that could execute there — javascript:, data:, blob: — and
 * anything that could leak a viewer's IP to a plain-text host is refused outright.
 */
function parseSourceUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0 || v.length > LIMITS.sourceUrlMax) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname || url.username || url.password) return null;
  return url.toString();
}

function parseSource(v: unknown): { kind: "drive" | "link"; url: string; name: string } | null {
  if (!isObj(v)) return null;
  if (v.kind !== "drive" && v.kind !== "link") return null;
  const url = parseSourceUrl(v.url);
  if (!url) return null;
  const name = cleanText(v.name, LIMITS.sourceNameMax);
  return { kind: v.kind, url, name: name || "Shared source" };
}

function parseSettings(v: unknown): Partial<RoomSettings> | undefined {
  if (!isObj(v)) return undefined;
  const out: Partial<RoomSettings> = {};
  if (v.control === "everyone" || v.control === "host") out.control = v.control;
  if (v.autoStart === "all" || v.autoStart === "most" || v.autoStart === "off") out.autoStart = v.autoStart;
  if (typeof v.pauseOnDisconnect === "boolean") out.pauseOnDisconnect = v.pauseOnDisconnect;
  if (typeof v.countdown === "boolean") out.countdown = v.countdown;
  return out;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || typeof v.t !== "string") return null;

  switch (v.t) {
    case "hello":
      if (!isNum(v.v)) return null;
      return {
        t: "hello",
        v: v.v,
        name: typeof v.name === "string" ? v.name.slice(0, 200) : "",
        pid: token(v.pid, 8, 32),
        secret: token(v.secret, 16, 64),
        hostKey: token(v.hostKey, 16, 64),
      };
    case "time":
      return isNum(v.c) ? { t: "time", c: v.c } : null;
    case "play":
    case "pause":
    case "seek":
      return isNum(v.pos) ? { t: v.t, pos: v.pos, aid: actionId(v.aid) } : null;
    case "rate":
      return isNum(v.rate) && RATES.includes(v.rate) ? { t: "rate", rate: v.rate, aid: actionId(v.aid) } : null;
    case "start":
    case "adoptMedia":
    case "ended":
    case "leave":
      return { t: v.t };
    case "ready":
      return typeof v.ready === "boolean" ? { t: "ready", ready: v.ready } : null;
    case "media": {
      if (v.media === null) return { t: "media", media: null };
      const media = parseFingerprint(v.media);
      return media ? { t: "media", media } : null;
    }
    case "source": {
      if (v.source === null) return { t: "source", source: null };
      const source = parseSource(v.source);
      return source ? { t: "source", source } : null;
    }
    case "call":
      if (typeof v.on !== "boolean") return null;
      return { t: "call", on: v.on, video: v.video === true, muted: v.muted !== false };
    case "rtc":
      // The payload stays opaque — it is relayed to one peer and never interpreted here.
      if (typeof v.to !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(v.to)) return null;
      if (typeof v.data !== "string" || v.data.length === 0 || v.data.length > LIMITS.rtcPayloadMax) return null;
      return { t: "rtc", to: v.to, data: v.data };
    case "chat":
      return typeof v.text === "string" ? { t: "chat", text: v.text.slice(0, 4000) } : null;
    case "react":
      return typeof v.emoji === "string" ? { t: "react", emoji: v.emoji } : null;
    case "moment":
      if (!isNum(v.pos)) return null;
      return {
        t: "moment",
        pos: v.pos,
        emoji: typeof v.emoji === "string" ? v.emoji : "",
        caption: typeof v.caption === "string" ? v.caption.slice(0, 1000) : "",
      };
    case "status":
      if (typeof v.sync !== "string" || !SYNC_STATUSES.has(v.sync)) return null;
      return { t: "status", sync: v.sync as SyncStatus, drift: isNum(v.drift) ? v.drift : null };
    case "settings": {
      const out: Extract<ClientMessage, { t: "settings" }> = { t: "settings" };
      if (typeof v.name === "string") out.name = v.name.slice(0, 200);
      const settings = parseSettings(v.settings);
      if (settings) out.settings = settings;
      return out;
    }
    case "grant":
      return typeof v.pid === "string" && typeof v.control === "boolean"
        ? { t: "grant", pid: v.pid, control: v.control }
        : null;
    default:
      return null;
  }
}
