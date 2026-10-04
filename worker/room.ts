import { DurableObject } from "cloudflare:workers";
import { LIMITS, TIMING } from "../shared/constants";
import { randomString } from "../shared/ids";
import {
  CLOSE,
  HEARTBEAT,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ControlMode,
  type RoomInfo,
  type ServerMessage,
} from "../shared/protocol";
import { Effects, RoomCore, newRoomData, type RoomData, type StorageKey } from "./core";
import { randomUint31, sha256Hex } from "./crypto";
import { parseClientMessage } from "./validate";

/** Per-socket state that survives hibernation. */
interface Attachment {
  pid: string | null;
  /** When the socket connected. */
  at: number;
  /** Last real (non-heartbeat) message, refreshed at most every 30 s. */
  seen: number;
}

const KEYS: StorageKey[] = ["meta", "playback", "media", "source", "participants", "chat", "moments"];
const deps = { randomId: (length: number) => randomString(length) };

/**
 * One instance per room. Uses the WebSocket Hibernation API: between messages the object is
 * evicted from memory while sockets stay connected, so an idle movie night costs no duration.
 * Heartbeats are answered by the runtime itself and never wake the object.
 */
export class RoomDurableObject extends DurableObject<Env> {
  private core: RoomCore | null = null;
  private readonly sockets = new Map<string, WebSocket>();
  private alarmAt: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT, HEARTBEAT));
    void ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<unknown>(KEYS);
      if (!stored.has("meta")) return;
      const data = {
        meta: stored.get("meta"),
        playback: stored.get("playback"),
        media: stored.get("media") ?? null,
        source: stored.get("source") ?? null,
        participants: stored.get("participants") ?? [],
        chat: stored.get("chat") ?? [],
        moments: stored.get("moments") ?? [],
      } as RoomData;
      this.core = new RoomCore(data, deps);

      const live = new Set<string>();
      for (const ws of ctx.getWebSockets()) {
        const att = ws.deserializeAttachment() as Attachment | null;
        if (att?.pid) {
          this.sockets.set(att.pid, ws);
          live.add(att.pid);
        }
      }
      if (this.core.reconcileOnline(live, Date.now())) await ctx.storage.put("participants", data.participants);
    });
  }

  // ── RPC (called by the Worker) ─────────────────────────────────────────────

  async create(input: {
    id: string;
    name: string;
    hostName: string;
    control: ControlMode;
    hostKeyHash: string;
  }): Promise<boolean> {
    if (this.core) return false; // id collision — the caller retries with a new id
    const now = Date.now();
    const data = newRoomData({ ...input, now });
    this.core = new RoomCore(data, deps);
    await this.ctx.storage.put({ ...data });
    // A room nobody ever joins disappears after the normal inactivity window.
    await this.setAlarm(now + TIMING.roomTtlMs);
    return true;
  }

  async info(): Promise<RoomInfo | null> {
    return this.core?.info() ?? null;
  }

  // ── WebSocket lifecycle ────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    if (!this.core) return new Response("Room not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const now = Date.now();
    server.serializeAttachment({ pid: null, at: now, seen: now } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const core = this.core;
    if (!core) return this.closeQuietly(ws, CLOSE.notFound, "Room expired");
    if (typeof message !== "string") return this.closeQuietly(ws, 1003, "Text frames only");
    if (message.length > LIMITS.frameBytes) return this.closeQuietly(ws, 1009, "Frame too large");

    const now = Date.now();
    const msg = parseClientMessage(message);
    if (!msg) return this.send(ws, { t: "error", code: "bad_request", message: "Malformed message." });

    // Clock sync needs no identity, so it works while the hello is still in flight.
    if (msg.t === "time") return this.send(ws, { t: "time", c: msg.c, s: now });

    const att = (ws.deserializeAttachment() as Attachment | null) ?? { pid: null, at: now, seen: now };
    if (msg.t === "hello") return this.onHello(ws, att, msg, now);

    const pid = att.pid;
    if (!pid || this.sockets.get(pid) !== ws) {
      return this.send(ws, { t: "error", code: "forbidden", message: "Join the room first." });
    }
    if (now - att.seen > 30_000) ws.serializeAttachment({ ...att, seen: now } satisfies Attachment);

    const fx = new Effects();
    if (msg.t === "leave") {
      this.sockets.delete(pid);
      ws.serializeAttachment({ ...att, pid: null } satisfies Attachment);
      core.disconnect(pid, now, true, fx);
      this.flush(fx);
      this.closeQuietly(ws, 1000, "Left the room");
      await this.afterPresenceChange();
      return;
    }
    core.handle(pid, msg, now, fx);
    this.flush(fx);
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.closeQuietly(ws, code === 1005 || code === 1006 ? 1000 : code, "Closed");
    if (this.dropSocket(ws)) await this.afterPresenceChange();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    if (this.dropSocket(ws)) await this.afterPresenceChange();
  }

  override async alarm(): Promise<void> {
    this.alarmAt = null;
    const core = this.core;
    if (!core) return;
    const now = Date.now();

    // 1. Silent disconnects: sockets that stopped heart-beating (closed laptop lids, dead Wi-Fi).
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      const heartbeat = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      const alive = Math.max(heartbeat, att?.seen ?? 0, att?.at ?? 0);
      if (now - alive > TIMING.staleSocketMs) {
        this.dropSocket(ws);
        this.closeQuietly(ws, CLOSE.stale, "No heartbeat");
      }
    }

    // 2. Viewers whose reconnect grace ran out.
    const fx = new Effects();
    core.sweep(now, fx);
    this.flush(fx);

    // 3. Empty rooms expire. Their data is deleted, not archived.
    if (this.sockets.size === 0 && now - core.data.meta.lastActivity >= TIMING.roomTtlMs) {
      for (const ws of this.ctx.getWebSockets()) this.closeQuietly(ws, CLOSE.notFound, "Room expired");
      this.core = null;
      this.sockets.clear();
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }

    await this.setAlarm(this.desiredAlarm(now));
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async onHello(
    ws: WebSocket,
    att: Attachment,
    msg: Extract<ClientMessage, { t: "hello" }>,
    now: number,
  ): Promise<void> {
    if (msg.v !== PROTOCOL_VERSION) {
      this.send(ws, { t: "error", code: "version", message: "STARBYTE was updated. Refresh to rejoin.", fatal: true });
      return this.closeQuietly(ws, CLOSE.version, "Protocol version mismatch");
    }
    if (att.pid) return this.send(ws, { t: "error", code: "bad_request", message: "Already joined." });

    const freshSecret = randomString(24);
    const [secretHash, hostKeyHash, freshHash] = await Promise.all([
      msg.secret ? sha256Hex(msg.secret) : null,
      msg.hostKey ? sha256Hex(msg.hostKey) : null,
      sha256Hex(freshSecret),
    ]);

    const core = this.core;
    if (!core) return this.closeQuietly(ws, CLOSE.notFound, "Room expired");

    const fx = new Effects();
    const result = core.hello(
      {
        name: msg.name,
        pid: msg.pid,
        secretHash,
        hostKeyHash,
        fresh: { pid: randomString(12), secret: freshSecret, secretHash: freshHash, avatar: randomUint31() },
      },
      now,
      fx,
    );
    if (!result.ok) {
      this.send(ws, { t: "error", code: result.code, message: result.message, fatal: true });
      return this.closeQuietly(ws, result.code === "room_full" ? CLOSE.roomFull : 1008, result.message);
    }

    // Same identity from a newer connection (refresh, duplicated tab): the old socket yields.
    const previous = this.sockets.get(result.pid);
    if (previous && previous !== ws) {
      const prevAtt = previous.deserializeAttachment() as Attachment | null;
      previous.serializeAttachment({ pid: null, at: prevAtt?.at ?? now, seen: now } satisfies Attachment);
      this.send(previous, {
        t: "error",
        code: "replaced",
        message: "You opened this room somewhere else.",
        fatal: true,
      });
      this.closeQuietly(previous, CLOSE.replaced, "Replaced by a newer connection");
    }

    ws.serializeAttachment({ pid: result.pid, at: att.at, seen: now } satisfies Attachment);
    this.sockets.set(result.pid, ws);
    this.send(ws, { t: "welcome", pid: result.pid, secret: result.secret, now, room: core.snapshot() });
    this.flush(fx);
    await this.afterPresenceChange();
  }

  /** Returns true when the socket belonged to a participant (presence changed). */
  private dropSocket(ws: WebSocket): boolean {
    const att = ws.deserializeAttachment() as Attachment | null;
    const pid = att?.pid;
    if (!pid || this.sockets.get(pid) !== ws) return false;
    this.sockets.delete(pid);
    ws.serializeAttachment({ ...att, pid: null } satisfies Attachment);
    const core = this.core;
    if (!core) return false;
    const fx = new Effects();
    core.disconnect(pid, Date.now(), false, fx);
    this.flush(fx);
    return true;
  }

  private flush(fx: Effects): void {
    const core = this.core;
    if (!core) return;
    for (const { to, msg } of fx.out) {
      const frame = JSON.stringify(msg);
      if (to.kind === "one") {
        const ws = this.sockets.get(to.pid);
        if (ws) this.sendRaw(ws, frame);
        continue;
      }
      for (const [pid, ws] of this.sockets) {
        if (to.kind === "all" || pid !== to.except) this.sendRaw(ws, frame);
      }
    }
    if (fx.dirty.size) {
      const entries: Record<string, unknown> = {};
      for (const key of fx.dirty) entries[key] = core.data[key];
      // Not awaited on purpose: output gates hold outgoing frames until the write is durable.
      void this.ctx.storage.put(entries);
    }
  }

  private desiredAlarm(now: number): number {
    const core = this.core;
    if (!core) return now + TIMING.roomTtlMs;
    if (this.sockets.size > 0) return now + TIMING.sweepMs;
    const expiry = core.data.meta.lastActivity + TIMING.roomTtlMs;
    const grace = core.nextGraceExpiry();
    return grace === null ? expiry : Math.min(expiry, grace + 1000);
  }

  /** Pull the alarm earlier when needed; never push it later (the alarm reschedules itself). */
  private async afterPresenceChange(): Promise<void> {
    if (!this.core) return;
    const desired = this.desiredAlarm(Date.now());
    if (this.alarmAt === null) this.alarmAt = await this.ctx.storage.getAlarm();
    if (this.alarmAt === null || this.alarmAt > desired) await this.setAlarm(desired);
  }

  private async setAlarm(at: number): Promise<void> {
    await this.ctx.storage.setAlarm(at);
    this.alarmAt = at;
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: WebSocket, frame: string): void {
    try {
      ws.send(frame);
    } catch {
      // Socket is already closing; its close event cleans up.
    }
  }

  private closeQuietly(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }
}
