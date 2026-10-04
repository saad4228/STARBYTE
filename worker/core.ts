import {
  LIMITS,
  LIVE_DEFAULT_LAG_S,
  LIVE_MAX_LAG_S,
  LIVE_MIN_LAG_S,
  MOMENT_DEFAULT_EMOJI,
  MOMENT_EMOJI,
  REACTIONS,
  TIMING,
} from "../shared/constants";
import { cleanText } from "../shared/format";
import {
  canControl,
  positionAt,
  type ChatMessage,
  type ClientMessage,
  type ControlMode,
  type ErrorCode,
  type MediaFingerprint,
  type ParticipantPublic,
  type PlaybackCause,
  type PlaybackState,
  type RoomInfo,
  type RoomMoment,
  type RoomSettings,
  type RoomSnapshot,
  type RoomSource,
  type RoomSourceKind,
  type ServerMessage,
} from "../shared/protocol";

/**
 * The authoritative room state machine.
 *
 * Pure and synchronous: no Cloudflare APIs, no clocks, no randomness of its own. Every
 * operation takes `now` and an `Effects` collector; the Durable Object adapter delivers the
 * collected messages and persists the touched storage keys. That keeps the hard part — who
 * may do what, and what the room looks like afterwards — trivially unit-testable.
 */

export interface ParticipantRecord extends ParticipantPublic {
  secretHash: string;
}

export interface RoomMeta {
  id: string;
  name: string;
  createdAt: number;
  hostKeyHash: string;
  hostName: string;
  settings: RoomSettings;
  /** Last time anyone was connected. Drives expiry of empty rooms. */
  lastActivity: number;
}

export interface RoomData {
  meta: RoomMeta;
  playback: PlaybackState;
  media: MediaFingerprint | null;
  source: RoomSource | null;
  participants: ParticipantRecord[];
  chat: ChatMessage[];
  moments: RoomMoment[];
}

export type StorageKey = keyof RoomData;

export type Target = { kind: "all" } | { kind: "others"; except: string } | { kind: "one"; pid: string };

export class Effects {
  readonly out: { to: Target; msg: ServerMessage }[] = [];
  readonly dirty = new Set<StorageKey>();

  all(msg: ServerMessage): void {
    this.out.push({ to: { kind: "all" }, msg });
  }
  others(except: string, msg: ServerMessage): void {
    this.out.push({ to: { kind: "others", except }, msg });
  }
  one(pid: string, msg: ServerMessage): void {
    this.out.push({ to: { kind: "one", pid }, msg });
  }
  touch(...keys: StorageKey[]): void {
    for (const key of keys) this.dirty.add(key);
  }
}

export interface CoreDeps {
  randomId(length: number): string;
}

export interface HelloInput {
  name: string;
  pid?: string;
  secretHash?: string | null;
  hostKeyHash?: string | null;
  /** Identity to hand out if this turns out to be a new participant. */
  fresh: { pid: string; secret: string; secretHash: string; avatar: number };
}

export type HelloResult =
  | { ok: true; pid: string; secret?: string; resumed: boolean }
  | { ok: false; code: ErrorCode; message: string };

export function newRoomData(input: {
  id: string;
  name: string;
  hostName: string;
  control: ControlMode;
  hostKeyHash: string;
  now: number;
}): RoomData {
  return {
    meta: {
      id: input.id,
      name: input.name,
      createdAt: input.now,
      hostKeyHash: input.hostKeyHash,
      hostName: input.hostName,
      settings: { control: input.control, autoStart: "all", pauseOnDisconnect: false, countdown: true },
      lastActivity: input.now,
    },
    playback: { status: "paused", position: 0, anchor: input.now, rate: 1, seq: 0, started: false, lag: null },
    media: null,
    source: null,
    participants: [],
    chat: [],
    moments: [],
  };
}

export function toPublic(p: ParticipantRecord): ParticipantPublic {
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    host: p.host,
    granted: p.granted,
    online: p.online,
    leftAt: p.leftAt,
    ready: p.ready,
    media: p.media,
    sync: p.sync,
    drift: p.drift,
    lag: p.lag,
    joinedAt: p.joinedAt,
    call: p.call,
  };
}

/** Same file, judged by the sampled fingerprint. A whole-file hash arriving later doesn't make it a new file. */
/**
 * The same bytes. Duration is deliberately excluded: a browser's first reading of a file's
 * length can be an estimate that it revises once it has seen more of the file, and a viewer
 * re-measuring the very same file must not look like they swapped it for a different one.
 */
function sameFile(a: MediaFingerprint | null, b: MediaFingerprint | null): boolean {
  if (!a || !b) return a === b;
  return a.sampleHash === b.sampleHash && a.size === b.size;
}

/** Token buckets: generous for humans, tight enough that one client cannot flood a room. */
const BUCKETS = {
  control: { capacity: 8, perSec: 2 },
  chat: { capacity: 6, perSec: 0.7 },
  react: { capacity: 12, perSec: 4 },
  moment: { capacity: 4, perSec: 0.2 },
  misc: { capacity: 20, perSec: 4 },
  // Signalling is bursty by nature: ICE candidates arrive in a flurry as they are gathered.
  rtc: { capacity: 60, perSec: 25 },
} as const;
type BucketName = keyof typeof BUCKETS;

export class RoomCore {
  private readonly buckets = new Map<string, { tokens: number; last: number }>();
  /** Seq of the playback state created by the first start, while its countdown is pending. */
  private pendingStartSeq: number | null = null;

  constructor(
    readonly data: RoomData,
    private readonly deps: CoreDeps,
  ) {}

  // ── Queries ────────────────────────────────────────────────────────────────

  find(pid: string): ParticipantRecord | undefined {
    return this.data.participants.find((p) => p.id === pid);
  }

  onlineCount(): number {
    return this.data.participants.filter((p) => p.online).length;
  }

  snapshot(): RoomSnapshot {
    const { meta } = this.data;
    return {
      id: meta.id,
      name: meta.name,
      createdAt: meta.createdAt,
      settings: meta.settings,
      media: this.data.media,
      source: this.data.source,
      playback: this.data.playback,
      participants: this.data.participants.map(toPublic),
      chat: this.data.chat.slice(-LIMITS.chatSnapshot),
      moments: this.data.moments,
      maxParticipants: LIMITS.maxParticipants,
    };
  }

  info(): RoomInfo {
    const { meta, media } = this.data;
    const host = this.data.participants.find((p) => p.host);
    return {
      id: meta.id,
      name: meta.name,
      hostName: host?.name ?? meta.hostName,
      online: this.onlineCount(),
      maxParticipants: LIMITS.maxParticipants,
      media: media ? { name: media.name, duration: media.duration } : null,
      started: this.data.playback.started,
    };
  }

  /** Earliest moment a reconnecting viewer's seat expires, or null if nobody is reconnecting. */
  nextGraceExpiry(): number | null {
    let next: number | null = null;
    for (const p of this.data.participants) {
      if (p.online || p.leftAt === null) continue;
      const expiry = p.leftAt + TIMING.reconnectGraceMs;
      if (next === null || expiry < next) next = expiry;
    }
    return next;
  }

  // ── Presence ───────────────────────────────────────────────────────────────

  hello(input: HelloInput, now: number, fx: Effects): HelloResult {
    const name = cleanText(input.name, LIMITS.nameMax) || "Guest";
    const holdsHostKey = !!input.hostKeyHash && input.hostKeyHash === this.data.meta.hostKeyHash;

    const existing = input.pid ? this.find(input.pid) : undefined;
    if (existing && input.secretHash && existing.secretHash === input.secretHash) {
      existing.online = true;
      existing.leftAt = null;
      existing.name = name;
      if (holdsHostKey && !existing.host) this.makeHost(existing, fx);
      this.ensureHost(fx);
      fx.others(existing.id, { t: "participant", participant: toPublic(existing) });
      fx.touch("participants");
      return { ok: true, pid: existing.id, resumed: true };
    }

    if (this.onlineCount() >= LIMITS.maxParticipants) {
      return { ok: false, code: "room_full", message: "This room is full." };
    }
    while (this.data.participants.length >= LIMITS.maxRecords) {
      const oldestOffline = this.data.participants
        .filter((p) => !p.online)
        .sort((a, b) => (a.leftAt ?? 0) - (b.leftAt ?? 0))[0];
      if (!oldestOffline) return { ok: false, code: "room_full", message: "This room is full." };
      this.remove(oldestOffline, fx);
    }

    const p: ParticipantRecord = {
      id: input.fresh.pid,
      name,
      avatar: input.fresh.avatar,
      host: false,
      granted: false,
      online: true,
      leftAt: null,
      ready: false,
      media: null,
      sync: "idle",
      drift: null,
      lag: null,
      joinedAt: now,
      call: null,
      secretHash: input.fresh.secretHash,
    };
    this.data.participants.push(p);
    if (holdsHostKey) this.makeHost(p, fx);
    this.ensureHost(fx);
    fx.others(p.id, { t: "participant", participant: toPublic(p), joined: true });
    fx.touch("participants");
    return { ok: true, pid: p.id, secret: input.fresh.secret, resumed: false };
  }

  /** `clean` = the viewer said goodbye; otherwise they dropped and keep their seat for a while. */
  disconnect(pid: string, now: number, clean: boolean, fx: Effects): void {
    const p = this.find(pid);
    if (!p) return;

    if (clean) {
      this.remove(p, fx);
    } else {
      p.online = false;
      p.leftAt = now;
      p.sync = "idle";
      // Their peer connections died with the socket; peers need to tear the bubbles down.
      if (p.call?.on) p.call = { on: false, video: false, muted: true };
      fx.others(pid, { t: "participant", participant: toPublic(p) });
      fx.touch("participants");

      const pb = this.data.playback;
      if (this.data.meta.settings.pauseOnDisconnect && pb.status === "playing" && pb.started) {
        const position = now < pb.anchor ? pb.position : this.clampPos(positionAt(pb, now));
        this.setPlayback({ status: "paused", position, anchor: now }, { pid, kind: "disconnect" }, fx);
      }
    }

    if (this.onlineCount() === 0) {
      this.data.meta.lastActivity = now;
      fx.touch("meta");
    }
    this.maybeAutoStart(now, fx);
  }

  /** Drop viewers whose reconnect grace ran out. */
  sweep(now: number, fx: Effects): void {
    for (const p of [...this.data.participants]) {
      if (!p.online && p.leftAt !== null && now - p.leftAt >= TIMING.reconnectGraceMs) this.remove(p, fx);
    }
  }

  /**
   * After the object wakes up, sockets that vanished while it was evicted are gone for good.
   * Mark their owners offline silently (no auto-pause for server-side events).
   */
  reconcileOnline(live: ReadonlySet<string>, now: number): boolean {
    let changed = false;
    for (const p of this.data.participants) {
      const online = live.has(p.id);
      if (p.online !== online) {
        p.online = online;
        p.leftAt = online ? null : now;
        changed = true;
      }
    }
    return changed;
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  handle(pid: string, msg: ClientMessage, now: number, fx: Effects): void {
    const p = this.find(pid);
    if (!p) return;

    switch (msg.t) {
      case "play":
        return this.onPlay(p, msg.pos, msg.aid, now, fx);
      case "pause":
        return this.onPause(p, msg.pos, msg.aid, now, fx);
      case "seek":
        return this.onSeek(p, msg.pos, msg.aid, now, fx);
      case "rate":
        return this.onRate(p, msg.rate, msg.aid, now, fx);
      case "start":
        return this.onStart(p, now, fx);
      case "ready":
        return this.onReady(p, msg.ready, now, fx);
      case "media":
        return this.onMedia(p, msg.media, now, fx);
      case "adoptMedia":
        return this.onAdoptMedia(p, now, fx);
      case "source":
        return this.onSource(p, msg.source, now, fx);
      case "call":
        return this.onCall(p, msg.on, msg.video, msg.muted, now, fx);
      case "rtc":
        return this.onRtc(p, msg.to, msg.data, now, fx);
      case "ended":
        return this.onEnded(p, now, fx);
      case "chat":
        return this.onChat(p, msg.text, now, fx);
      case "react":
        return this.onReact(p, msg.emoji, now, fx);
      case "moment":
        return this.onMoment(p, msg.pos, msg.emoji, msg.caption, now, fx);
      case "status":
        return this.onStatus(p, msg.sync, msg.drift, msg.lag, now, fx);
      case "lag":
        return this.onLag(p, msg.lag, now, fx);
      case "settings":
        return this.onSettings(p, msg.name, msg.settings, now, fx);
      case "grant":
        return this.onGrant(p, msg.pid, msg.control, now, fx);
      case "leave":
        return this.disconnect(p.id, now, true, fx);
      case "hello":
      case "time":
        return; // handled by the adapter
    }
  }

  private onPlay(p: ParticipantRecord, pos: number, aid: string | undefined, now: number, fx: Effects): void {
    if (!this.take(p.id, "control", now)) return this.rateLimited(p, fx, aid);
    if (!this.requireControl(p, fx, aid) || !this.requireMedia(p, fx, aid)) return;

    const pb = this.data.playback;
    if (pb.status === "playing") return this.confirm(p, "play", aid, fx);

    let position = this.clampPos(pos);
    if (!this.isLive() && position >= this.duration() - 0.25) position = 0; // play at the end restarts
    if (!pb.started) return this.start(now, { pid: p.id, kind: "start", aid }, fx, position);
    this.setPlayback(
      { status: "playing", position, anchor: now + TIMING.resumeLeadMs },
      { pid: p.id, kind: "play", aid },
      fx,
    );
  }

  private onPause(p: ParticipantRecord, pos: number, aid: string | undefined, now: number, fx: Effects): void {
    if (!this.take(p.id, "control", now)) return this.rateLimited(p, fx, aid);
    if (!this.requireControl(p, fx, aid)) return;

    const pb = this.data.playback;
    if (pb.status === "paused") return this.confirm(p, "pause", aid, fx);

    let position: number;
    let started = pb.started;
    if (now < pb.anchor) {
      // Cancels a countdown or a scheduled resume. Cancelling the very first start
      // drops the room back into its ready check.
      position = pb.position;
      if (this.pendingStartSeq === pb.seq) started = false;
    } else {
      // Trust the pauser's frame when it is plausible; otherwise use the room's own clock.
      const expected = positionAt(pb, now);
      position = Math.abs(pos - expected) <= 5 ? pos : expected;
    }
    this.pendingStartSeq = null;
    this.setPlayback(
      { status: "paused", position: this.clampPos(position), anchor: now, started },
      { pid: p.id, kind: "pause", aid },
      fx,
    );
  }

  private onSeek(p: ParticipantRecord, pos: number, aid: string | undefined, now: number, fx: Effects): void {
    if (!this.take(p.id, "control", now)) return this.rateLimited(p, fx, aid);
    if (!this.requireControl(p, fx, aid) || !this.requireMedia(p, fx, aid)) return;
    if (this.isLive()) {
      // There is no position to seek to on a broadcast; the room moves relative to the edge.
      fx.one(p.id, {
        t: "error",
        code: "bad_request",
        message: "This is live — move the room closer to or further from the live edge instead.",
        aid,
      });
      return;
    }

    const pb = this.data.playback;
    const position = this.clampPos(pos);
    // While playing, everyone jumps and resumes together a beat later. A pending
    // countdown keeps its start time and just changes where it starts.
    const anchor = pb.status === "playing" ? Math.max(pb.anchor, now + TIMING.resumeLeadMs) : now;
    const startPending = this.pendingStartSeq === pb.seq;
    this.setPlayback({ position, anchor }, { pid: p.id, kind: "seek", aid }, fx);
    if (startPending) this.pendingStartSeq = this.data.playback.seq;
  }

  private onRate(p: ParticipantRecord, rate: number, aid: string | undefined, now: number, fx: Effects): void {
    if (!this.take(p.id, "control", now)) return this.rateLimited(p, fx, aid);
    if (!this.requireControl(p, fx, aid)) return;

    const pb = this.data.playback;
    if (pb.rate === rate) return this.confirm(p, "rate", aid, fx);
    if (pb.status === "playing" && now >= pb.anchor) {
      // Re-anchor at the current position so the speed change does not teleport anyone.
      this.setPlayback(
        { position: this.clampPos(positionAt(pb, now)), anchor: now, rate },
        { pid: p.id, kind: "rate", aid },
        fx,
      );
    } else {
      this.setPlayback({ rate }, { pid: p.id, kind: "rate", aid }, fx);
    }
  }

  private onStart(p: ParticipantRecord, now: number, fx: Effects): void {
    if (!this.take(p.id, "control", now)) return this.rateLimited(p, fx);
    if (!this.requireControl(p, fx) || !this.requireMedia(p, fx)) return;
    if (this.data.playback.started) return this.confirm(p, "start", undefined, fx);
    this.start(now, { pid: p.id, kind: "start" }, fx);
  }

  private onReady(p: ParticipantRecord, ready: boolean, now: number, fx: Effects): void {
    if (!this.take(p.id, "misc", now)) return;
    if (ready && !p.media) {
      fx.one(p.id, { t: "error", code: "bad_request", message: "Load your media before marking ready." });
      return;
    }
    if (p.ready === ready) return;
    p.ready = ready;
    fx.all({ t: "participant", participant: toPublic(p) });
    fx.touch("participants");
    this.maybeAutoStart(now, fx);
  }

  private onMedia(p: ParticipantRecord, media: MediaFingerprint | null, now: number, fx: Effects): void {
    if (!this.take(p.id, "misc", now)) return;
    const changed = !sameFile(p.media, media);
    p.media = media;
    if (changed) p.ready = false;
    if (!media) p.sync = "idle";
    fx.all({ t: "participant", participant: toPublic(p) });
    fx.touch("participants");

    const room = this.data.media;
    const control = canControl(p, this.data.meta.settings);
    // The first controller to bring media defines what the room is watching.
    if (!room && media && control) return this.adopt(p, now, fx);
    // Same file, but a player re-measured its length. Every seek in the room is clamped to
    // this number, so a stale estimate here leaves people unable to scrub past it — take the
    // correction rather than letting the room stay stuck on a wrong length.
    if (room && media && sameFile(room, media) && room.duration !== media.duration) {
      this.data.media = { ...room, duration: media.duration };
      fx.all(this.roomMsg());
      fx.touch("media");
    }
    // A controller verified the room's own file end to end: record the whole-file hash on the reference.
    if (room && media?.fullHash && control && !room.fullHash && sameFile(room, media)) {
      this.data.media = { ...room, fullHash: media.fullHash };
      fx.all(this.roomMsg());
      fx.touch("media");
    }
  }

  private onAdoptMedia(p: ParticipantRecord, now: number, fx: Effects): void {
    if (!this.take(p.id, "control", now)) return this.rateLimited(p, fx);
    if (!this.requireControl(p, fx)) return;
    if (!p.media) {
      fx.one(p.id, { t: "error", code: "bad_request", message: "Load your media first." });
      return;
    }
    if (sameFile(this.data.media, p.media)) return;
    this.adopt(p, now, fx);
  }

  /**
   * Point the room at one shared URL (a Drive file or a direct link) instead of everyone's own
   * copy. The server keeps the URL and nothing more — it never fetches, proxies or validates the
   * bytes. Each viewer loads it themselves and reports back the usual fingerprint, so the ready
   * check, duration and drift logic downstream stay exactly as they are for local files.
   */
  private onSource(
    p: ParticipantRecord,
    source: { kind: RoomSourceKind; url: string; name: string } | null,
    now: number,
    fx: Effects,
  ): void {
    if (!this.take(p.id, "control", now)) return this.rateLimited(p, fx);
    if (!this.requireControl(p, fx)) return;
    if (this.data.source?.url === source?.url) return;

    this.data.source = source ? { ...source, pid: p.id, at: now } : null;
    // The room is now watching something else, so nobody's file is the reference any more.
    this.data.media = null;
    for (const other of this.data.participants) {
      if (!other.media && !other.ready && other.sync === "idle") continue;
      other.media = null;
      other.ready = false;
      other.sync = "idle";
      other.drift = null;
      fx.all({ t: "participant", participant: toPublic(other) });
    }
    if (this.data.moments.length) {
      this.data.moments = [];
      fx.all({ t: "moments", moments: [] });
      fx.touch("moments");
    }
    this.pendingStartSeq = null;
    this.setPlayback({ status: "paused", position: 0, anchor: now, started: false }, { pid: p.id, kind: "media" }, fx);
    fx.all(this.roomMsg());
    fx.touch("source", "media", "participants");
  }

  private onCall(
    p: ParticipantRecord,
    on: boolean,
    video: boolean,
    muted: boolean,
    now: number,
    fx: Effects,
  ): void {
    if (!this.take(p.id, "misc", now)) return;
    if (on && !p.call?.on && this.callerCount() >= LIMITS.maxCallers) {
      fx.one(p.id, {
        t: "error",
        code: "capacity",
        message: `The call is full (${LIMITS.maxCallers} people).`,
      });
      return;
    }
    const next = { on, video: on && video, muted: on ? muted : true };
    if (p.call && p.call.on === next.on && p.call.video === next.video && p.call.muted === next.muted) return;
    p.call = next;
    fx.all({ t: "participant", participant: toPublic(p) });
    fx.touch("participants");
  }

  /**
   * Relay one peer's signalling to another. The payload is opaque to the room: it is never
   * parsed, stored or broadcast, only handed to the single participant it is addressed to.
   */
  private onRtc(p: ParticipantRecord, to: string, data: string, now: number, fx: Effects): void {
    if (!this.take(p.id, "rtc", now)) return;
    const peer = this.find(to);
    if (!peer || !peer.online || peer.id === p.id) return;
    fx.one(peer.id, { t: "rtc", from: p.id, data });
  }

  private callerCount(): number {
    let n = 0;
    for (const p of this.data.participants) if (p.online && p.call?.on) n++;
    return n;
  }

  private roomMsg(): ServerMessage {
    return {
      t: "room",
      name: this.data.meta.name,
      settings: this.data.meta.settings,
      media: this.data.media,
      source: this.data.source,
    };
  }

  private onEnded(p: ParticipantRecord, now: number, fx: Effects): void {
    if (!this.take(p.id, "misc", now)) return;
    const pb = this.data.playback;
    const duration = this.duration();
    if (pb.status !== "playing" || duration <= 0) return;
    // Verified against the room's own clock; a client cannot end the movie early.
    if (positionAt(pb, now) >= duration - 1.5) {
      this.setPlayback({ status: "paused", position: duration, anchor: now }, { pid: p.id, kind: "ended" }, fx);
    }
  }

  private onChat(p: ParticipantRecord, raw: string, now: number, fx: Effects): void {
    if (!this.take(p.id, "chat", now)) return this.rateLimited(p, fx);
    const text = cleanText(raw, LIMITS.chatMax);
    if (!text) return;
    const message: ChatMessage = { id: this.deps.randomId(10), pid: p.id, name: p.name, text, at: now };
    const chat = this.data.chat;
    chat.push(message);
    if (chat.length > LIMITS.chatHistory) chat.splice(0, chat.length - LIMITS.chatHistory);
    fx.all({ t: "chat", message });
    fx.touch("chat");
  }

  private onReact(p: ParticipantRecord, emoji: string, now: number, fx: Effects): void {
    if (!(REACTIONS as readonly string[]).includes(emoji)) return;
    if (!this.take(p.id, "react", now)) return; // silently drop reaction spam
    // Not persisted: reactions are ephemeral. The sender renders its own instantly.
    fx.others(p.id, { t: "react", pid: p.id, emoji });
  }

  private onMoment(
    p: ParticipantRecord,
    pos: number,
    emoji: string,
    caption: string,
    now: number,
    fx: Effects,
  ): void {
    if (!this.take(p.id, "moment", now)) return this.rateLimited(p, fx);
    if (!this.requireMedia(p, fx)) return;
    if (this.data.moments.length >= LIMITS.momentsMax) {
      fx.one(p.id, { t: "error", code: "bad_request", message: "This room has saved all the moments it can hold." });
      return;
    }
    const moment: RoomMoment = {
      id: this.deps.randomId(10),
      position: this.clampPos(pos),
      pid: p.id,
      name: p.name,
      emoji: MOMENT_EMOJI.includes(emoji) ? emoji : MOMENT_DEFAULT_EMOJI,
      caption: cleanText(caption, LIMITS.captionMax),
      at: now,
    };
    this.data.moments.push(moment);
    fx.all({ t: "moment", moment });
    fx.touch("moments");
  }

  private onStatus(
    p: ParticipantRecord,
    sync: ParticipantPublic["sync"],
    drift: number | null,
    lag: number | null | undefined,
    now: number,
    fx: Effects,
  ): void {
    if (!this.take(p.id, "misc", now)) return;
    const rounded = drift === null ? null : Math.round(Math.max(-864e5, Math.min(864e5, drift)));
    // A tenth of a second is as fine as anyone needs to see "how far behind am I".
    const nextLag = lag === undefined ? p.lag : lag === null ? null : Math.round(lag * 10) / 10;
    if (p.sync === sync && p.drift === rounded && p.lag === nextLag) return;
    p.sync = sync;
    p.drift = rounded;
    p.lag = nextLag;
    fx.others(p.id, { t: "participant", participant: toPublic(p) });
    fx.touch("participants");
  }

  /**
   * Move the whole room closer to or further from the live edge. This is the live equivalent
   * of a seek: there is no position to agree on, only a shared distance from "now".
   */
  private onLag(p: ParticipantRecord, lag: number, now: number, fx: Effects): void {
    if (!this.take(p.id, "control", now)) return this.rateLimited(p, fx);
    if (!this.requireControl(p, fx)) return;
    if (this.data.playback.lag === null) {
      fx.one(p.id, { t: "error", code: "bad_request", message: "This room isn't watching a live source." });
      return;
    }
    const next = Math.round(Math.max(LIVE_MIN_LAG_S, Math.min(LIVE_MAX_LAG_S, lag)) * 10) / 10;
    if (next === this.data.playback.lag) return;
    this.setPlayback({ lag: next }, { pid: p.id, kind: "seek" }, fx);
  }

  private onSettings(
    p: ParticipantRecord,
    rawName: string | undefined,
    patch: Partial<RoomSettings> | undefined,
    now: number,
    fx: Effects,
  ): void {
    if (!this.take(p.id, "misc", now)) return;
    if (!p.host) {
      fx.one(p.id, { t: "error", code: "forbidden", message: "Only the host can change room settings." });
      return;
    }
    const meta = this.data.meta;
    let changed = false;
    if (rawName !== undefined) {
      const name = cleanText(rawName, LIMITS.roomNameMax);
      if (name && name !== meta.name) {
        meta.name = name;
        changed = true;
      }
    }
    if (patch) {
      const next: RoomSettings = { ...meta.settings, ...patch };
      if (JSON.stringify(next) !== JSON.stringify(meta.settings)) {
        meta.settings = next;
        changed = true;
      }
    }
    if (!changed) return;
    fx.all(this.roomMsg());
    fx.touch("meta");
    this.maybeAutoStart(now, fx);
  }

  private onGrant(p: ParticipantRecord, targetId: string, control: boolean, now: number, fx: Effects): void {
    if (!this.take(p.id, "misc", now)) return;
    if (!p.host) {
      fx.one(p.id, { t: "error", code: "forbidden", message: "Only the host can grant control." });
      return;
    }
    const target = this.find(targetId);
    if (!target || target.host || target.granted === control) return;
    target.granted = control;
    fx.all({ t: "participant", participant: toPublic(target) });
    fx.touch("participants");
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private duration(): number {
    return this.data.media?.duration ?? 0;
  }

  private clampPos(pos: number): number {
    // Nothing to clamp against on a broadcast: it has no length and no end.
    if (this.isLive()) return Math.max(0, pos);
    return Math.min(Math.max(0, pos), Math.max(0, this.duration()));
  }

  private isLive(): boolean {
    return this.data.playback.lag !== null;
  }

  private setPlayback(next: Partial<PlaybackState>, cause: PlaybackCause | null, fx: Effects): void {
    const playback: PlaybackState = { ...this.data.playback, ...next, seq: this.data.playback.seq + 1 };
    this.data.playback = playback;
    fx.all({ t: "playback", playback, cause });
    fx.touch("playback");
  }

  private start(now: number, cause: PlaybackCause, fx: Effects, position?: number): void {
    const lead = this.data.meta.settings.countdown ? TIMING.countdownMs : TIMING.resumeLeadMs;
    this.setPlayback(
      {
        status: "playing",
        position: position ?? this.data.playback.position,
        anchor: now + lead,
        started: true,
      },
      cause,
      fx,
    );
    this.pendingStartSeq = this.data.playback.seq;
  }

  /** Ready check: start by itself once all (or most) connected viewers are ready. */
  private maybeAutoStart(now: number, fx: Effects): void {
    const { playback, media, meta } = this.data;
    if (playback.started || !media || meta.settings.autoStart === "off") return;
    const online = this.data.participants.filter((p) => p.online);
    if (online.length < 2) return; // alone in a room? press START NOW instead
    const ready = online.filter((p) => p.ready).length;
    const go = meta.settings.autoStart === "all" ? ready === online.length : ready >= 2 && ready * 2 > online.length;
    if (go) this.start(now, { pid: null, kind: "autostart" }, fx);
  }

  private adopt(p: ParticipantRecord, now: number, fx: Effects): void {
    this.data.media = p.media;
    // A broadcast has no timeline to agree on, so the room switches to holding a shared
    // distance behind the edge instead of a shared position.
    const live = p.media?.live === true;
    if (this.data.moments.length) {
      this.data.moments = []; // moments belong to the previous media's timeline
      fx.all({ t: "moments", moments: [] });
      fx.touch("moments");
    }
    this.pendingStartSeq = null;
    this.setPlayback(
      { status: "paused", position: 0, anchor: now, started: false, lag: live ? LIVE_DEFAULT_LAG_S : null },
      { pid: p.id, kind: "media" },
      fx,
    );
    for (const other of this.data.participants) {
      if (other !== p && other.ready) {
        other.ready = false;
        fx.all({ t: "participant", participant: toPublic(other) });
      }
    }
    fx.all(this.roomMsg());
    fx.touch("media", "participants");
  }

  private makeHost(p: ParticipantRecord, fx: Effects): void {
    for (const other of this.data.participants) {
      if (other !== p && other.host) {
        other.host = false;
        fx.all({ t: "participant", participant: toPublic(other) });
      }
    }
    p.host = true;
    p.granted = false;
    fx.touch("participants");
  }

  /** Someone must always be able to run the room: promote the longest-present viewer. */
  private ensureHost(fx: Effects): void {
    if (this.data.participants.some((p) => p.host)) return;
    const candidate = this.data.participants
      .filter((p) => p.online)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (!candidate) return;
    candidate.host = true;
    candidate.granted = false;
    fx.all({ t: "participant", participant: toPublic(candidate) });
    fx.touch("participants");
  }

  private remove(p: ParticipantRecord, fx: Effects): void {
    const index = this.data.participants.indexOf(p);
    if (index === -1) return;
    this.data.participants.splice(index, 1);
    for (const key of this.buckets.keys()) if (key.startsWith(`${p.id}:`)) this.buckets.delete(key);
    fx.all({ t: "left", pid: p.id });
    fx.touch("participants");
    if (p.host) this.ensureHost(fx);
  }

  private requireControl(p: ParticipantRecord, fx: Effects, aid?: string): boolean {
    if (canControl(p, this.data.meta.settings)) return true;
    fx.one(p.id, { t: "error", code: "forbidden", message: "Only the host can control playback in this room.", aid });
    fx.one(p.id, { t: "playback", playback: this.data.playback, cause: null }); // drop their prediction
    return false;
  }

  private requireMedia(p: ParticipantRecord, fx: Effects, aid?: string): boolean {
    if (this.data.media) return true;
    fx.one(p.id, { t: "error", code: "bad_request", message: "Choose the room's media first.", aid });
    return false;
  }

  /** Re-send the current state so a client can reconcile a no-op action. */
  private confirm(p: ParticipantRecord, kind: PlaybackCause["kind"], aid: string | undefined, fx: Effects): void {
    fx.one(p.id, { t: "playback", playback: this.data.playback, cause: { pid: p.id, kind, aid } });
  }

  private rateLimited(p: ParticipantRecord, fx: Effects, aid?: string): void {
    fx.one(p.id, { t: "error", code: "rate_limited", message: "Easy there — slow down a little.", aid });
  }

  private take(pid: string, name: BucketName, now: number): boolean {
    const spec = BUCKETS[name];
    const key = `${pid}:${name}`;
    const bucket = this.buckets.get(key) ?? { tokens: spec.capacity, last: now };
    bucket.tokens = Math.min(spec.capacity, bucket.tokens + ((now - bucket.last) / 1000) * spec.perSec);
    bucket.last = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}
