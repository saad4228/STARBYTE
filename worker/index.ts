import { LIMITS } from "../shared/constants";
import { cleanText } from "../shared/format";
import { newRoomId, normalizeRoomId, randomString } from "../shared/ids";
import type { ControlMode, CreateRoomRequest, CreateRoomResponse } from "../shared/protocol";
import { sha256Hex } from "./crypto";
import { Gatekeeper } from "./gatekeeper";
import { RoomDurableObject } from "./room";
import { Stats } from "./stats";

export { Gatekeeper, RoomDurableObject, Stats };

/**
 * API surface (everything else is served as static assets and never reaches this Worker):
 *
 *   POST /api/rooms            create a room → { roomId, hostKey }
 *   GET  /api/rooms/:id        public room card
 *   GET  /api/rooms/:id/ws     WebSocket upgrade, forwarded to the room's Durable Object
 *   GET  /api/visits           read the visit counters
 *   POST /api/visits           record one visit, then read the counters
 *   GET  /api/health
 */
export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/api/health") return json({ ok: true, time: Date.now() });

      if (pathname === "/api/visits") {
        const stats = env.STATS.get(env.STATS.idFromName("site"));
        if (request.method === "GET") return json(await stats.peek());
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "GET, POST" });
        if (!originAllowed(request, env)) return json({ error: "forbidden_origin" }, 403);
        return json(await stats.hit(await ipKeyOf(request)));
      }

      if (pathname === "/api/rooms") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
        return await createRoom(request, env);
      }

      const match = pathname.match(/^\/api\/rooms\/([^/]+)(\/ws)?$/);
      if (match?.[1]) {
        const id = normalizeRoomId(decodeURIComponent(match[1]));
        if (!id) return json({ error: "not_found" }, 404);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(id));

        if (match[2]) {
          if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            // Echo the host we were addressed as. A client that can't get a socket open uses
            // this to tell "something is blocking WebSockets" apart from "a proxy rewrote the
            // Host header", which are the same symptom but completely different fixes.
            return json({ error: "upgrade_required", host: new URL(request.url).host }, 426);
          }
          if (!originAllowed(request, env)) return json({ error: "forbidden_origin" }, 403);
          return stub.fetch(request);
        }

        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
        const info = await stub.info();
        return info ? json(info) : json({ error: "not_found" }, 404);
      }

      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error("api_error", pathname, err);
      return json({ error: "internal" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function createRoom(request: Request, env: Env): Promise<Response> {
  if (!originAllowed(request, env)) return json({ error: "forbidden_origin" }, 403);

  const text = await request.text();
  if (text.length > LIMITS.bodyBytes) return json({ error: "too_large" }, 413);
  let body: Partial<Record<keyof CreateRoomRequest, unknown>>;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const name = cleanText(body.name, LIMITS.roomNameMax) || "Movie Night";
  const hostName = cleanText(body.hostName, LIMITS.nameMax) || "Host";
  const control: ControlMode = body.control === "host" ? "host" : "everyone";

  const verdict = await env.GATE.get(env.GATE.idFromName("global")).admit(await ipKeyOf(request));
  if (verdict === "capacity") {
    return json({ error: "capacity", message: "Free-tier capacity reached. Please try again later." }, 503);
  }
  if (verdict === "ip") {
    return json({ error: "rate_limited", message: "You're opening rooms quickly — try again in a bit." }, 429);
  }

  const hostKey = randomString(32);
  const hostKeyHash = await sha256Hex(hostKey);
  for (let attempt = 0; attempt < 3; attempt++) {
    const roomId = newRoomId();
    const created = await env.ROOMS.get(env.ROOMS.idFromName(roomId)).create({
      id: roomId,
      name,
      hostName,
      control,
      hostKeyHash,
    });
    if (created) return json({ roomId, hostKey } satisfies CreateRoomResponse, 201);
  }
  return json({ error: "internal" }, 500);
}

/**
 * A salted, truncated hash of the caller's IP. Enough to rate-limit a single source;
 * the address itself is never stored.
 */
async function ipKeyOf(request: Request): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  return (await sha256Hex(`starbyte-gate:${ip}`)).slice(0, 20);
}

/**
 * Browsers always send Origin on WebSocket upgrades and cross-origin POSTs. Only our own
 * origin (plus any explicitly configured ones) may drive rooms from a browser.
 */
function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // non-browser client; Origin checks only guard browsers
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.host === new URL(request.url).host) return true;
  const extra = String(env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.includes(parsed.origin);
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}
