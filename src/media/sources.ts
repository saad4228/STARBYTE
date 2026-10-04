import { LIMITS } from "../../shared/constants";
import type { MediaFingerprint, RoomSourceKind } from "../../shared/protocol";

/**
 * Shared sources: one URL that everybody in the room loads, rather than everybody opening their
 * own copy of a file. Nothing here ever touches the room server — the link is resolved in the
 * browser, probed in the browser, and played by the browser.
 */

export interface ResolvedSource {
  kind: RoomSourceKind;
  /** The URL that actually goes into a <video src>. */
  url: string;
  name: string;
  /** Shown before the host commits, when the link is likely to disappoint. */
  warning?: string;
}

export class SourceError extends Error {}

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com", "drive.usercontent.google.com"]);
const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv)(?:$|[?#])/i;
const HLS_EXT = /\.(m3u8)(?:$|[?#])/i;
const DASH_EXT = /\.(mpd)(?:$|[?#])/i;

/** Pull the file id out of any of the shapes Drive hands people when they copy a link. */
function driveFileId(url: URL): string | null {
  const byPath = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname);
  if (byPath?.[1]) return byPath[1];
  const byQuery = url.searchParams.get("id");
  if (byQuery && /^[A-Za-z0-9_-]{10,}$/.test(byQuery)) return byQuery;
  const byDownload = /\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname);
  return byDownload?.[1] ?? null;
}

function prettyName(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop();
  if (!last) return url.hostname;
  try {
    return decodeURIComponent(last).slice(0, LIMITS.sourceNameMax);
  } catch {
    return last.slice(0, LIMITS.sourceNameMax);
  }
}

function canPlayType(mime: string): boolean {
  const probe = document.createElement("video");
  return probe.canPlayType(mime) !== "";
}

/**
 * Turn whatever the host pasted into something a <video> can actually open, or explain why it
 * cannot. Deliberately strict about the scheme: this URL is handed to everyone else's browser.
 */
export function resolveSource(input: string): ResolvedSource {
  const text = input.trim();
  if (!text) throw new SourceError("Paste a link first.");
  if (text.length > LIMITS.sourceUrlMax) throw new SourceError("That link is too long.");

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new SourceError("That doesn't look like a link. It needs to start with https://");
  }
  if (url.protocol === "http:") {
    throw new SourceError("Only https links work — an http one would be blocked as insecure content.");
  }
  if (url.protocol !== "https:") throw new SourceError("Only https links are supported.");

  if (DRIVE_HOSTS.has(url.hostname)) return resolveDrive(url);

  if (HLS_EXT.test(url.pathname) && !canPlayType("application/vnd.apple.mpegurl")) {
    throw new SourceError(
      "This is an HLS stream, which this browser can't play on its own. Safari and iOS can; Chrome and Firefox need a direct .mp4 or .webm instead.",
    );
  }
  if (DASH_EXT.test(url.pathname)) {
    throw new SourceError("DASH streams (.mpd) aren't supported. Use a direct .mp4, .webm, or an HLS link on Safari.");
  }

  const known = VIDEO_EXT.test(url.pathname) || HLS_EXT.test(url.pathname);
  return {
    kind: "link",
    url: url.toString(),
    name: prettyName(url),
    warning: known
      ? undefined
      : "This link doesn't end in a video file, so it may be a web page rather than the video itself. Checking it now.",
  };
}

function resolveDrive(url: URL): ResolvedSource {
  if (url.pathname.includes("/folders/")) {
    throw new SourceError("That's a Drive folder. Open the video itself and copy its link.");
  }
  const id = driveFileId(url);
  if (!id) {
    throw new SourceError("Couldn't find a file id in that Drive link. Use Share → Copy link on the video.");
  }
  return {
    kind: "drive",
    // The host that serves the actual bytes; /uc redirects here anyway.
    url: `https://drive.usercontent.google.com/download?id=${id}&export=download`,
    name: "Google Drive video",
    warning:
      "Drive has to be set to “Anyone with the link”, and it refuses to serve large files directly — if the check below fails, that's why.",
  };
}

export interface SourceProbe {
  duration: number;
  width: number;
  height: number;
}

/**
 * Load just the metadata to prove the link really plays here, before it is pushed to the room.
 * A host who publishes a dead link breaks the room for everyone, so this always runs first.
 */
export function probeSource(url: string, timeoutMs = 20_000): Promise<SourceProbe> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    // Not `crossOrigin`: plain media playback does not need CORS, and asking for it makes
    // hosts that do not send the header fail when they would otherwise have worked.
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeEventListener("loadedmetadata", ok);
      v.removeEventListener("error", fail);
      v.removeAttribute("src");
      v.load();
      fn();
    };
    const ok = () => {
      const duration = v.duration;
      const probe = { duration, width: v.videoWidth, height: v.videoHeight };
      done(() => {
        if (!Number.isFinite(duration) || duration <= 0) {
          reject(new SourceError("That link opened, but it has no fixed length — live streams can't be synced yet."));
        } else {
          resolve(probe);
        }
      });
    };
    const fail = () => {
      done(() =>
        reject(
          new SourceError(
            "That link didn't play. It's usually one of: the file isn't shared publicly, the host blocks direct playback, or it isn't a video file.",
          ),
        ),
      );
    };
    const timer = setTimeout(
      () => done(() => reject(new SourceError("That link took too long to respond. It may be private or very slow."))),
      timeoutMs,
    );
    v.addEventListener("loadedmetadata", ok);
    v.addEventListener("error", fail);
    v.src = url;
    v.load();
  });
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A fingerprint for a shared source. Everyone derives it from the same URL, so it is identical
 * for every viewer by construction — which is the whole point: the existing media check, ready
 * gate and duration logic then work for links exactly as they do for local files.
 */
export async function sourceFingerprint(
  source: { url: string; name: string },
  probe: SourceProbe,
): Promise<MediaFingerprint> {
  const hash = await sha256Hex(`starbyte-source:${source.url}`);
  return {
    name: source.name,
    size: 0,
    duration: probe.duration,
    mime: "",
    width: probe.width,
    height: probe.height,
    sampleHash: hash.slice(0, 32),
  };
}
