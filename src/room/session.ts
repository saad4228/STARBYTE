import { LIMITS, TIMING } from "../../shared/constants";
import { cleanText, formatTime } from "../../shared/format";
import { compareMedia, type MediaComparison } from "../../shared/media";
import {
  canControl,
  CLOSE,
  PROTOCOL_VERSION,
  type ChatMessage,
  type ClientMessage,
  type MediaFingerprint,
  type ParticipantPublic,
  type PlaybackCause,
  type PlaybackState,
  type RoomInfo,
  type RoomSettings,
  type RoomSnapshot,
  type RoomSource,
  type ServerMessage,
  type SyncStatus,
} from "../../shared/protocol";
import { fetchRoomInfo, roomSocketUrl } from "../app/api";
import { forgetIdentity, loadHostKey, loadIdentity, loadName, saveIdentity, saveName, suggestName } from "../app/identity";
import { navigate } from "../lib/router";
import { AnalysisError, analyzeFile, deepVerify, type AnalysisStep, type MediaAnalysis } from "../media/analyze";
import type { MediaAdapter } from "../media/adapter";
import { Html5MediaAdapter } from "../media/html5";
import { YouTubeAdapter, YouTubeError, parseYouTubeId } from "../media/youtube";
import { probeSource, resolveSource, SourceError, sourceFingerprint, type ResolvedSource } from "../media/sources";
import { CallManager, type CallSnapshot } from "../call/manager";
import { attachSubtitles, readSubtitleFile, setSubtitlesVisible } from "../media/subtitles";
import { ServerClock } from "../sync/clock";
import { IDLE_SNAPSHOT, SyncEngine, type SyncSnapshot } from "../sync/engine";
import { RoomConnection, type ConnStatus } from "./connection";
import { loadPrefs, savePrefs, type Prefs } from "./prefs";
import { Store } from "./store";

export type Phase = "loading" | "gate" | "lobby" | "entering" | "room" | "error";
export type PanelTab = "chat" | "people" | "moments";

export interface SessionError {
  kind: "not_found" | "full" | "replaced" | "version" | "network" | "invalid";
  title: string;
  message: string;
}

export interface AnalysisState {
  /** Null while a shared link is loading — there is no local file to name. */
  file: File | null;
  steps: AnalysisStep[];
  error: string | null;
  done: boolean;
}

export interface LocalMedia {
  /** The viewer's own file. Null when the room is on a shared link instead. */
  file: File | null;
  /** Local-file analysis. Null for a shared link, which is probed rather than hashed. */
  analysis: MediaAnalysis | null;
  /** Set when this came from a room-wide link rather than a file on disk. */
  source: ResolvedSource | null;
  fingerprint: MediaFingerprint;
  adapter: MediaAdapter;
  url: string;
  subtitles: { label: string; detach: () => void } | null;
  /** Whole-file verification progress, 0–1, while it runs. */
  verifying: number | null;
}

export interface Toast {
  id: number;
  tone: "info" | "ok" | "warn" | "danger";
  text: string;
}

export interface FloatReaction {
  id: number;
  emoji: string;
  x: number;
  name: string | null;
}

export type ChatItem = ({ kind: "message" } & ChatMessage) | { kind: "system"; id: string; text: string; at: number };

export interface ConnState {
  status: ConnStatus | "idle";
  attempt: number;
  rtt: number | null;
  clockReady: boolean;
  /** Why a connection that never succeeded is failing. Null while things are fine. */
  trouble: string | null;
}

export type DialogName = "settings" | "media" | "help";

export interface UiState {
  cinema: boolean;
  tab: PanelTab;
  dialog: DialogName | null;
  unread: number;
}

export interface SessionState {
  roomId: string;
  phase: Phase;
  info: RoomInfo | null;
  error: SessionError | null;
  name: string;
  isCreator: boolean;
  conn: ConnState;
  me: string | null;
  room: RoomSnapshot | null;
  pending: { playback: PlaybackState; aid: string; until: number } | null;
  analysis: AnalysisState | null;
  media: LocalMedia | null;
  /** Null until the viewer first opens the call UI. */
  call: CallSnapshot;
  /** Set while a shared link is being checked before it goes to the room. */
  sourceCheck: { url: string; error: string | null; busy: boolean } | null;
  sync: SyncSnapshot;
  prefs: Prefs;
  chat: ChatItem[];
  overlay: ChatItem[];
  floats: FloatReaction[];
  toasts: Toast[];
  ui: UiState;
}

const CHAT_KEEP = 200;

/** A shared source becomes whichever player can actually play it. */
function buildSourceAdapter(source: RoomSource, duration: number): MediaAdapter {
  if (source.kind === "youtube") {
    let id: string | null = null;
    try {
      id = parseYouTubeId(new URL(source.url));
    } catch {
      id = null;
    }
    if (id) return new YouTubeAdapter(id, duration);
  }
  return new Html5MediaAdapter(source.kind, source.url, duration);
}

const IDLE_CALL: CallSnapshot = {
  joined: false,
  joining: false,
  muted: false,
  video: false,
  local: null,
  peers: [],
  speaking: [],
  error: null,
  blocked: false,
};

/** How far the movie drops while someone is talking over it. */
const DUCK_FACTOR = 0.35;

/**
 * Everything a viewer's browser knows about one room. Owns the socket, the server clock, the
 * local media and the sync engine; React components only read slices and call actions.
 */
export class RoomSession {
  readonly store: Store<SessionState>;
  readonly clock = new ServerClock();
  private readonly engine: SyncEngine;
  /** Exposed for the dev console and the end-to-end tests. */
  readonly call: CallManager;
  private conn: RoomConnection | null = null;
  private readonly abort = new AbortController();
  private readonly hostKey: string | null;
  private disposed = false;
  private seq = 1;
  private timers = new Set<number>();
  private resyncTimer = 0;
  private watchdogTimer = 0;
  private statusTimer = 0;
  private lastStatus: SyncStatus | null = null;
  private cinemaTouched = false;
  private welcomed = false;
  private reconnecting = false;
  private clockBaseline = 0;
  private phaseBeforeError: Phase = "lobby";

  constructor(roomId: string) {
    this.hostKey = loadHostKey(roomId);
    this.store = new Store<SessionState>({
      roomId,
      phase: "loading",
      info: null,
      error: null,
      name: loadName(),
      isCreator: !!this.hostKey,
      conn: { status: "idle", attempt: 0, rtt: null, clockReady: false, trouble: null },
      me: null,
      room: null,
      pending: null,
      analysis: null,
      media: null,
      call: IDLE_CALL,
      sourceCheck: null,
      sync: IDLE_SNAPSHOT,
      prefs: loadPrefs(),
      chat: [],
      overlay: [],
      floats: [],
      toasts: [],
      ui: { cinema: false, tab: "chat", dialog: null, unread: 0 },
    });
    this.engine = new SyncEngine({
      clock: this.clock,
      getPlayback: () => this.playback(),
      getConfig: () => this.store.get().prefs.drift,
      onSnapshot: (sync) => {
        this.store.set({ sync });
        this.reconcileDuration();
        this.reportStatus();
      },
      onEnded: () => this.send({ t: "ended" }),
      onJump: (driftMs) => {
        if (this.store.get().prefs.notify.sync && Math.abs(driftMs) > 1500) {
          this.toast("info", `Jumped ${(Math.abs(driftMs) / 1000).toFixed(1)}s to rejoin the room`);
        }
      },
    });
    this.call = new CallManager({
      self: () => this.store.get().me,
      signal: (to, data) => this.send({ t: "rtc", to, data }),
      setPresence: (on, video, muted) => this.send({ t: "call", on, video, muted }),
      onChange: (snapshot) => {
        const was = this.store.get().call;
        this.store.set({ call: snapshot });
        if (snapshot.error && snapshot.error !== was.error) this.toast("danger", snapshot.error);
        if (snapshot.blocked && !was.blocked) {
          this.toast(
            "warn",
            "Couldn't reach someone directly — calls go peer to peer, so a strict network can block them.",
          );
        }
        if (snapshot.speaking.length !== was.speaking.length) {
          this.applyDuck(this.store.get().prefs.duckOnTalk && snapshot.speaking.length > 0);
        }
      },
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const { roomId } = this.store.get();
    try {
      const info = await fetchRoomInfo(roomId, this.abort.signal);
      if (this.disposed) return;
      if (!info) {
        return this.fail({
          kind: "not_found",
          title: "This room doesn't exist",
          message: "The code may be mistyped, or the room expired after a day with nobody inside.",
        });
      }
      this.store.set({ info });
      const name = loadName();
      // Creators and returning viewers (after a refresh) skip the name screen.
      if (name && (this.hostKey || loadIdentity(roomId))) this.join(name);
      else this.store.set({ phase: "gate" });
    } catch {
      if (this.disposed) return;
      this.fail({ kind: "network", title: "Can't reach STARBYTE", message: "Check your connection, then try again." });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    for (const t of this.timers) clearTimeout(t);
    clearInterval(this.resyncTimer);
    clearInterval(this.watchdogTimer);
    clearTimeout(this.statusTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.engine.detach();
    this.call.dispose();
    const media = this.store.get().media;
    if (media) this.release(media);
    this.conn?.close();
  }

  join(rawName: string): void {
    const name = cleanText(rawName, LIMITS.nameMax) || suggestName();
    saveName(name);
    this.store.set({ name, phase: "lobby" });
    this.connect();
  }

  /** "You're watching in another tab" → take the room back to this tab. */
  reclaim(): void {
    this.store.set({ error: null, phase: this.phaseBeforeError });
    this.connect();
  }

  leave(): void {
    this.send({ t: "leave" });
    forgetIdentity(this.store.get().roomId);
    this.dispose();
    navigate("/");
  }

  private connect(): void {
    this.conn?.close();
    this.welcomed = false;
    const conn = new RoomConnection(roomSocketUrl(this.store.get().roomId), {
      onOpen: () => this.hello(),
      onMessage: (m) => this.onMessage(m),
      onStatus: (status, attempt) => this.onConnStatus(status, attempt),
      onFatal: (code) => this.onFatal(code),
      onTrouble: (trouble) => this.store.set((st) => ({ conn: { ...st.conn, trouble } })),
    });
    this.conn = conn;
    conn.connect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    document.addEventListener("visibilitychange", this.onVisibility);
    clearInterval(this.resyncTimer);
    this.resyncTimer = window.setInterval(() => this.syncClock(3), TIMING.clockResyncMs);
    clearInterval(this.watchdogTimer);
    this.clockBaseline = Date.now() - this.clock.local();
    this.watchdogTimer = window.setInterval(() => this.checkClockJump(), 5000);
  }

  private hello(): void {
    const id = loadIdentity(this.store.get().roomId);
    this.conn?.send({
      t: "hello",
      v: PROTOCOL_VERSION,
      name: this.store.get().name,
      pid: id?.pid,
      secret: id?.secret,
      hostKey: this.hostKey ?? undefined,
    });
    this.syncClock(6);
  }

  private syncClock(count: number): void {
    for (let i = 0; i < count; i++) this.later(() => this.conn?.send({ t: "time", c: this.clock.local() }), i * 120);
  }

  /** The monotonic clock can pause while a laptop sleeps; re-measure if it drifted from wall time. */
  private checkClockJump(): void {
    const baseline = Date.now() - this.clock.local();
    if (Math.abs(baseline - this.clockBaseline) > 1000) {
      this.clockBaseline = baseline;
      this.clock.reset();
      this.syncClock(5);
      this.conn?.probe();
    }
  }

  private readonly onVisibility = () => {
    if (document.visibilityState !== "visible") return;
    this.conn?.probe();
    this.syncClock(3);
  };

  private onConnStatus(status: ConnStatus, attempt: number): void {
    const prev = this.store.get().conn;
    if (status === "reconnecting" && prev.status === "open") {
      this.reconnecting = true;
      if (this.store.get().prefs.notify.connection) this.toast("warn", "Connection lost — playback keeps going while we reconnect.");
    }
    this.store.set({ conn: { ...prev, status, attempt } });
  }

  private onFatal(code: number): void {
    const errors: Record<number, SessionError> = {
      [CLOSE.notFound]: {
        kind: "not_found",
        title: "This room doesn't exist",
        message: "The code may be mistyped, or the room expired after a day with nobody inside.",
      },
      [CLOSE.roomFull]: {
        kind: "full",
        title: "This room is full",
        message: `Rooms hold up to ${LIMITS.maxParticipants} viewers for now. Ask the host to open another one.`,
      },
      [CLOSE.replaced]: {
        kind: "replaced",
        title: "You're watching in another tab",
        message: "This room is open somewhere else in this browser.",
      },
      [CLOSE.version]: {
        kind: "version",
        title: "STARBYTE was updated",
        message: "Refresh the page to rejoin with the latest version.",
      },
    };
    this.fail(errors[code] ?? { kind: "network", title: "Disconnected", message: "The room closed the connection." });
  }

  private fail(error: SessionError): void {
    const phase = this.store.get().phase;
    if (phase !== "error") this.phaseBeforeError = phase === "loading" || phase === "gate" ? "lobby" : phase;
    this.store.set({ phase: "error", error });
  }

  // ── Server messages ───────────────────────────────────────────────────────

  private onMessage(m: ServerMessage): void {
    const s = this.store.get();
    switch (m.t) {
      case "welcome": {
        if (m.secret) saveIdentity(s.roomId, m.pid, m.secret);
        this.clock.seed(m.now);
        this.welcomed = true;
        this.lastStatus = null;
        const myMedia = s.media?.fingerprint;
        this.store.set({
          me: m.pid,
          room: m.room,
          pending: null,
          chat: m.room.chat.map((c) => ({ kind: "message" as const, ...c })),
          info: s.info ? { ...s.info, name: m.room.name } : s.info,
        });
        const mine = m.room.participants.find((p) => p.id === m.pid);
        if (myMedia && (mine?.media?.sampleHash !== myMedia.sampleHash || mine?.media?.fullHash !== myMedia.fullHash)) {
          this.send({ t: "media", media: myMedia });
        }
        if (this.reconnecting) {
          this.reconnecting = false;
          if (s.prefs.notify.connection) this.toast("ok", "Reconnected — back in sync.");
        }
        this.engine.poke();
        this.maybeAutoCinema();
        this.syncCallPeers();
        // If we dropped long enough for the room to notice, it cleared our call state and the
        // others hung up on us. Our own UI would still claim we were in the call.
        if (this.store.get().call.joined && !mine?.call?.on) this.call.resync();
        // A room that is already on a shared link arrives in the snapshot, not as a `room`
        // message — so a viewer joining mid-session has to pick it up from here.
        if (m.room.source) this.onRoomSource(m.room.source);
        return;
      }
      case "time": {
        this.clock.addSample(m.c, m.s);
        this.store.set({ conn: { ...this.store.get().conn, rtt: this.clock.latency, clockReady: this.clock.ready } });
        return;
      }
      case "playback":
        return this.onPlayback(m.playback, m.cause);
      case "participant":
        return this.onParticipant(m.participant, !!m.joined);
      case "left": {
        if (!s.room) return;
        const gone = s.room.participants.find((p) => p.id === m.pid);
        this.patchRoom({ participants: s.room.participants.filter((p) => p.id !== m.pid) });
        this.syncCallPeers();
        if (gone && m.pid !== s.me) {
          this.system(`${gone.name} left`);
          if (s.prefs.notify.presence) this.toast("info", `${gone.name} left the room`);
        }
        return;
      }
      case "room": {
        if (!s.room) return;
        const changed = s.room.media?.sampleHash !== m.media?.sampleHash;
        const sourceChanged = s.room.source?.url !== m.source?.url;
        this.patchRoom({ name: m.name, settings: m.settings, media: m.media, source: m.source });
        if (sourceChanged) this.onRoomSource(m.source);
        if (changed && m.media) {
          this.system(`Now showing: ${m.media.name}`);
          const mine = this.store.get().media;
          if (mine && compareMedia(m.media, mine.fingerprint).match === "mismatch") {
            this.toast("warn", "The room switched to a different file. Pick a matching copy to stay in sync.");
          }
        }
        this.engine.poke();
        return;
      }
      case "chat": {
        const item: ChatItem = { kind: "message", ...m.message };
        const mine = m.message.pid === s.me;
        const hidden = s.ui.cinema || s.ui.tab !== "chat";
        this.store.set((st) => ({
          chat: [...st.chat, item].slice(-CHAT_KEEP),
          ui: !mine && hidden ? { ...st.ui, unread: st.ui.unread + 1 } : st.ui,
        }));
        if (!mine && s.ui.cinema && s.prefs.chatOverlay) this.overlay(item);
        return;
      }
      case "react": {
        if (s.prefs.showReactions) this.float(m.emoji, this.nameOf(m.pid));
        return;
      }
      case "moment": {
        if (!s.room) return;
        this.patchRoom({ moments: [...s.room.moments, m.moment] });
        const caption = m.moment.caption ? ` — “${m.moment.caption}”` : "";
        this.system(`${m.moment.emoji} ${m.moment.name} marked ${formatTime(m.moment.position, true)}${caption}`);
        if (m.moment.pid === s.me) this.toast("ok", `${m.moment.emoji} Moment saved · ${formatTime(m.moment.position, true)}`);
        return;
      }
      case "moments": {
        if (s.room) this.patchRoom({ moments: m.moments });
        return;
      }
      case "rtc":
        void this.call.onSignal(m.from, m.data);
        return;
      case "error": {
        if (m.aid && s.pending?.aid === m.aid) this.store.set({ pending: null });
        if (!m.fatal) this.toast(m.code === "rate_limited" ? "warn" : "danger", m.message);
        this.engine.poke();
        return;
      }
    }
  }

  private onPlayback(pb: PlaybackState, cause: PlaybackCause | null): void {
    const s = this.store.get();
    if (!s.room || pb.seq < s.room.playback.seq) return; // stale
    const prev = s.room.playback;
    this.store.set({ room: { ...s.room, playback: pb }, pending: null });
    this.engine.poke();
    if (cause && cause.pid !== s.me) this.narrate(pb, cause);
    if (!prev.started && pb.started) this.maybeAutoCinema();
  }

  private onParticipant(p: ParticipantPublic, joined: boolean): void {
    const s = this.store.get();
    if (!s.room) return;
    const prev = s.room.participants.find((x) => x.id === p.id);
    const participants = prev ? s.room.participants.map((x) => (x.id === p.id ? p : x)) : [...s.room.participants, p];
    this.patchRoom({ participants });
    this.syncCallPeers();
    if (p.id === s.me || !this.welcomed) return;
    if (joined) {
      this.system(`${p.name} joined`);
      if (s.prefs.notify.presence) this.toast("info", `${p.name} joined the room`);
    } else if (prev?.online && !p.online) {
      this.system(`${p.name} dropped — reconnecting…`);
    } else if (prev && !prev.online && p.online) {
      this.system(`${p.name} is back`);
    } else if (prev && !prev.ready && p.ready && !s.room.playback.started) {
      this.system(`${p.name} is ready`);
    }
  }

  private narrate(pb: PlaybackState, cause: PlaybackCause): void {
    const who = cause.pid ? this.nameOf(cause.pid) ?? "Someone" : null;
    const at = formatTime(pb.position, true);
    const text: Record<PlaybackCause["kind"], string | null> = {
      play: `${who} pressed play`,
      pause: `${who} paused at ${at}`,
      seek: `${who} moved playback to ${at}`,
      rate: `${who} set the speed to ${pb.rate}×`,
      start: `${who} started the movie`,
      autostart: "Everyone's ready — starting!",
      ended: "That's the end. Roll credits.",
      disconnect: `Paused — ${who} dropped out`,
      media: null,
    };
    const line = text[cause.kind];
    if (!line) return;
    this.system(line);
    if (this.store.get().prefs.notify.playback) this.toast("info", line);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  /** The playback state the engine follows: our own prediction for a moment, then the server's. */
  playback(): PlaybackState | null {
    const s = this.store.get();
    if (s.pending && performance.now() < s.pending.until) return s.pending.playback;
    return s.room?.playback ?? null;
  }

  self(): ParticipantPublic | null {
    const s = this.store.get();
    return s.room?.participants.find((p) => p.id === s.me) ?? null;
  }

  canControl(): boolean {
    const me = this.self();
    const settings = this.store.get().room?.settings;
    return !!me && !!settings && canControl(me, settings);
  }

  isHost(): boolean {
    return !!this.self()?.host;
  }

  comparison(): MediaComparison | null {
    const s = this.store.get();
    return s.room?.media && s.media ? compareMedia(s.room.media, s.media.fingerprint) : null;
  }

  nameOf(pid: string): string | null {
    return this.store.get().room?.participants.find((p) => p.id === pid)?.name ?? null;
  }

  // ── Playback actions (predicted locally, confirmed by the room) ───────────

  play(): void {
    if (!this.guardControl()) return;
    const s = this.store.get();
    const pb = this.playback();
    if (!pb || !s.room?.media || pb.status === "playing") return;
    const duration = s.room.media.duration;
    let pos = pb.started ? this.localPosition() : pb.position;
    if (pos >= duration - 0.25) pos = 0;
    const lead = !pb.started && s.room.settings.countdown ? TIMING.countdownMs : TIMING.resumeLeadMs;
    this.act({ t: "play", pos }, { status: "playing", position: pos, started: true }, lead);
  }

  pause(): void {
    if (!this.guardControl()) return;
    const pb = this.playback();
    if (!pb || pb.status === "paused") return;
    const now = this.clock.serverNow();
    const pos = now < pb.anchor ? pb.position : this.localPosition();
    this.act({ t: "pause", pos }, { status: "paused", position: pos }, 0);
  }

  togglePlay(): void {
    const pb = this.playback();
    if (pb?.status === "playing") this.pause();
    else this.play();
  }

  seek(position: number): void {
    if (!this.guardControl()) return;
    const s = this.store.get();
    const pb = this.playback();
    if (!pb || !s.room?.media) return;
    if (pb.lag !== null) return; // live: nothing to seek to
    const pos = Math.min(Math.max(0, position), s.room.media.duration);
    const now = this.clock.serverNow();
    const lead = pb.status === "playing" ? Math.max(pb.anchor - now, TIMING.resumeLeadMs) : 0;
    this.act({ t: "seek", pos }, { position: pos }, lead);
  }

  seekBy(delta: number): void {
    this.seek(this.localPosition() + delta);
  }

  setRate(rate: number): void {
    if (!this.guardControl()) return;
    this.send({ t: "rate", rate, aid: this.aid() });
  }

  startNow(): void {
    if (!this.guardControl()) return;
    this.send({ t: "start" });
  }

  setReady(ready: boolean): void {
    this.send({ t: "ready", ready });
  }

  /** Called from a click: lets the browser play this element later, and restores muted audio. */
  unlockAudio(): void {
    const media = this.store.get().media;
    if (!media) return;
    // Only a real <video> needs this nudge; the embedded players manage their own unlocking.
    const v = media.adapter.element;
    if (v instanceof HTMLVideoElement && v.paused && this.playback()?.status !== "playing") {
      const wasMuted = v.muted;
      v.muted = true;
      v.play()
        .then(() => {
          if (this.playback()?.status !== "playing") v.pause();
          v.muted = wasMuted;
        })
        .catch(() => {
          v.muted = wasMuted;
        });
    }
    this.engine.unblock();
  }

  localPosition(): number {
    const s = this.store.get();
    return s.media ? s.media.adapter.getCurrentTime() : s.sync.target;
  }

  private act(msg: Extract<ClientMessage, { t: "play" | "pause" | "seek" }>, next: Partial<PlaybackState>, leadMs: number): void {
    const base = this.playback();
    const aid = this.aid();
    if (!base || !this.send({ ...msg, aid })) {
      this.toast("warn", "Not connected right now — try again in a moment.");
      return;
    }
    // Predict the server's answer so the button feels instant. The server anchors on its own
    // receive time; half a round trip later than ours.
    const anchor = this.clock.serverNow() + leadMs + (leadMs > 0 ? (this.clock.latency ?? 0) / 2 : 0);
    this.store.set({ pending: { playback: { ...base, ...next, anchor }, aid, until: performance.now() + 3000 } });
    this.engine.poke();
  }

  private guardControl(): boolean {
    if (this.canControl()) return true;
    this.toast("warn", "Only the host can control playback in this room.");
    return false;
  }

  // ── Social ────────────────────────────────────────────────────────────────

  chat(text: string): boolean {
    const clean = cleanText(text, LIMITS.chatMax);
    if (!clean) return false;
    if (!this.send({ t: "chat", text: clean })) {
      this.toast("warn", "Message not sent — reconnecting.");
      return false;
    }
    return true;
  }

  react(emoji: string): void {
    this.float(emoji, null);
    this.send({ t: "react", emoji });
  }

  mark(emoji: string, caption: string, position = this.store.get().sync.target): void {
    if (!this.send({ t: "moment", pos: position, emoji, caption })) {
      this.toast("warn", "Moment not saved — reconnecting.");
    }
  }

  // ── Host ──────────────────────────────────────────────────────────────────

  updateRoom(patch: { name?: string; settings?: Partial<RoomSettings> }): void {
    this.send({ t: "settings", ...patch });
  }

  grant(pid: string, control: boolean): void {
    this.send({ t: "grant", pid, control });
  }

  adoptMedia(): void {
    if (!this.guardControl()) return;
    this.send({ t: "adoptMedia" });
  }

  /**
   * The length a file reports before playing is not always the truth. Browsers estimate it for
   * some containers and revise it once they have read further, and phone recordings in
   * particular can carry a flatly wrong figure in their metadata.
   *
   * That one number decides a great deal: the room clamps every seek to it, so a value that is
   * too short leaves people unable to scrub past it and stuck on "catching up" forever, and a
   * wrong value makes two copies of the same film look like different files. So the element
   * that is actually playing gets the last word, and the correction goes to the room.
   */
  private watchDuration(adapter: MediaAdapter): void {
    adapter.subscribe((e) => {
      if (e === "loadedmetadata" || e === "durationchange" || e === "ended") this.reconcileDuration();
    });
  }

  /**
   * Checked on every sync tick as well as on the player's own duration events, because the two
   * figures can disagree without anything firing: the probe runs once, before playback, and
   * whatever it concluded is then frozen into the fingerprint.
   */
  private reconcileDuration(): void {
    const media = this.store.get().media;
    if (!media) return;
    const live = media.adapter.getDuration();
    if (!Number.isFinite(live) || live <= 0) return;
    if (Math.abs(live - media.fingerprint.duration) < 0.5) return;

    const fingerprint = { ...media.fingerprint, duration: live };
    this.patchMedia({ fingerprint });
    this.send({ t: "media", media: fingerprint });
    this.engine.poke();
  }

  // ── Live ──────────────────────────────────────────────────────────────────

  /**
   * Catch this viewer up to the room's live edge. Local, not room-wide: falling behind is a
   * personal problem — a buffer stall, a slow network — and the rest of the room should not be
   * dragged backwards because one person's connection hiccupped.
   */
  syncToLive(): void {
    const { media, room } = this.store.get();
    const lag = room?.playback.lag;
    if (!media || lag === null || lag === undefined) return;
    if (!media.adapter.isLive()) return;
    if (!media.adapter.canSeek()) {
      // Nothing to seek on a plain stream; the engine closes the gap by playing faster.
      this.toast("info", "This stream can't be skipped forward — catching up gradually instead.");
      this.engine.poke();
      return;
    }
    media.adapter.seek(Math.max(0, media.adapter.getLiveEdge() - lag));
    this.engine.poke();
  }

  /** Move the whole room nearer to or further from the edge. Needs control. */
  setLiveLag(lag: number): void {
    if (!this.guardControl()) return;
    if (this.store.get().room?.playback.lag === null) return;
    this.send({ t: "lag", lag });
  }

  // ── Shared sources (Drive / link) ─────────────────────────────────────────

  /**
   * Put a link up for the whole room. It is resolved and actually played here first: a host who
   * publishes a dead link would break the room for everyone, and the error is far easier to act
   * on while it is still just their own screen.
   */
  async setSource(input: string): Promise<boolean> {
    if (!this.guardControl()) return false;
    this.store.set({ sourceCheck: { url: input, error: null, busy: true } });
    try {
      const resolved = resolveSource(input);
      await probeSource(resolved.url);
      if (this.disposed) return false;
      this.store.set({ sourceCheck: null });
      this.send({ t: "source", source: { kind: resolved.kind, url: resolved.url, name: resolved.name } });
      return true;
    } catch (err) {
      const error = err instanceof SourceError ? err.message : "That link couldn't be used.";
      this.store.set({ sourceCheck: { url: input, error, busy: false } });
      return false;
    }
  }

  clearSource(): void {
    if (!this.guardControl()) return;
    this.send({ t: "source", source: null });
  }

  dismissSourceCheck(): void {
    this.store.set({ sourceCheck: null });
  }

  /**
   * The room moved to (or off) a shared link. Everyone loads the same URL and reports the same
   * derived fingerprint, so from here on the ready check, duration and drift logic are exactly
   * the ones that run for local files.
   */
  private onRoomSource(source: RoomSource | null): void {
    const current = this.store.get().media;
    if (!source) {
      // Back to everyone's own file; drop a link we loaded, keep a real file.
      if (current?.source) {
        this.release(current);
        this.store.set({ media: null });
        this.send({ t: "media", media: null });
      }
      return;
    }
    if (current?.source?.url === source.url) return;
    void this.loadSource(source);
  }

  private async loadSource(source: RoomSource): Promise<void> {
    this.store.set({ analysis: { file: null, steps: [], error: null, done: false } });
    try {
      const probe = await probeSource(source.url);
      const fingerprint = await sourceFingerprint(source, probe);
      if (this.disposed || this.store.get().room?.source?.url !== source.url) return;

      const previous = this.store.get().media;
      if (previous) this.release(previous);

      const adapter = buildSourceAdapter(source, probe.duration);
      const { prefs } = this.store.get();
      adapter.setVolume(prefs.volume);
      adapter.setMuted(prefs.muted);
      adapter.subscribe((e) => {
        if (e === "error" && this.store.get().media?.adapter === adapter) {
          this.toast("danger", "The shared source stopped playing. It may have expired or been made private.");
        }
      });
      this.watchDuration(adapter);
      const media: LocalMedia = {
        file: null,
        analysis: null,
        source: { kind: source.kind, url: source.url, name: source.name },
        fingerprint,
        adapter,
        url: source.url,
        subtitles: null,
        verifying: null,
      };
      this.store.set({ media, analysis: null });
      this.engine.attach(adapter);
      // YouTube builds its player only once the element is on the page, which the stage does.
      void adapter.load().catch((err: unknown) => {
        if (this.store.get().media?.adapter !== adapter) return;
        this.toast("danger", err instanceof YouTubeError ? err.message : "The shared source could not be opened.");
      });
      this.send({ t: "media", media: fingerprint });
      this.system(`Now showing: ${source.name}`);
    } catch (err) {
      if (this.disposed) return;
      const message = err instanceof SourceError ? err.message : "The room's link couldn't be opened here.";
      this.store.set((st) => ({ analysis: st.analysis && { ...st.analysis, error: message, done: true } }));
      this.toast("danger", message);
    }
  }

  // ── Call ──────────────────────────────────────────────────────────────────

  async joinCall(withVideo: boolean): Promise<void> {
    await this.call.join(withVideo);
    this.syncCallPeers();
  }

  leaveCall(): void {
    this.call.leave();
  }

  setCallMuted(muted: boolean): void {
    this.call.setMuted(muted);
  }

  async setCallVideo(on: boolean): Promise<void> {
    await this.call.setVideo(on);
  }

  /** Connect to exactly the people who are online and in the call. */
  private syncCallPeers(): void {
    const room = this.store.get().room;
    if (!room) return;
    this.call.setPeers(room.participants.filter((p) => p.online && p.call?.on).map((p) => p.id));
  }

  /**
   * Drop the movie under a voice so people can hear each other without reaching for the volume.
   * It only touches the adapter, never the saved preference, so nothing is lost when talk stops.
   */
  private applyDuck(speaking: boolean): void {
    const { media, prefs } = this.store.get();
    if (!media) return;
    media.adapter.setVolume(speaking ? prefs.volume * DUCK_FACTOR : prefs.volume);
  }

  // ── Media ─────────────────────────────────────────────────────────────────

  async selectFile(file: File): Promise<void> {
    this.store.set({ analysis: { file, steps: [], error: null, done: false } });
    const isCurrent = () => !this.disposed && this.store.get().analysis?.file === file;
    try {
      const analysis = await analyzeFile(file, (steps) => {
        if (isCurrent()) this.store.set((st) => ({ analysis: st.analysis && { ...st.analysis, steps } }));
      });
      if (!isCurrent()) return;
      const previous = this.store.get().media;
      if (previous) this.release(previous);

      const url = URL.createObjectURL(file);
      const adapter = new Html5MediaAdapter("local", url, analysis.fingerprint.duration);
      const { prefs } = this.store.get();
      adapter.setVolume(prefs.volume);
      adapter.setMuted(prefs.muted);
      adapter.subscribe((e) => {
        if (e === "error" && this.store.get().media?.adapter === adapter) {
          this.toast("danger", "This browser stopped playing the file. Try another copy or format.");
        }
      });
      this.watchDuration(adapter);
      const media: LocalMedia = {
        file,
        analysis,
        source: null,
        fingerprint: analysis.fingerprint,
        adapter,
        url,
        subtitles: null,
        verifying: null,
      };
      this.store.set((st) => ({ media, analysis: st.analysis && { ...st.analysis, done: true } }));
      this.engine.attach(adapter);
      this.send({ t: "media", media: analysis.fingerprint });
    } catch (err) {
      if (!isCurrent()) return;
      const message = err instanceof AnalysisError ? err.message : "Couldn't read this file.";
      this.store.set((st) => ({ analysis: st.analysis && { ...st.analysis, error: message } }));
    }
  }

  clearAnalysis(): void {
    this.store.set({ analysis: null });
  }

  async verifyFile(): Promise<void> {
    const media = this.store.get().media;
    if (!media?.file || media.verifying !== null) return;
    this.patchMedia({ verifying: 0 });
    try {
      const fullHash = await deepVerify(media.file, (p) => this.patchMedia({ verifying: p }));
      if (this.store.get().media?.file !== media.file) return;
      const fingerprint = { ...media.fingerprint, fullHash };
      this.patchMedia({ fingerprint, verifying: null });
      this.send({ t: "media", media: fingerprint });
      this.toast("ok", "Whole file verified.");
    } catch {
      this.patchMedia({ verifying: null });
      this.toast("danger", "Verification failed — the file couldn't be read.");
    }
  }

  async loadSubtitles(file: File): Promise<void> {
    const media = this.store.get().media;
    const video = media?.adapter.element;
    if (!media || !(video instanceof HTMLVideoElement)) {
      // An embedded player carries its own captions; we cannot staple a track onto it.
      if (media) this.toast("warn", "Subtitle files only work with your own video — this source brings its own captions.");
      return;
    }
    try {
      const vtt = await readSubtitleFile(file);
      media.subtitles?.detach();
      const detach = attachSubtitles(video, vtt, file.name);
      this.patchMedia({ subtitles: { label: file.name, detach } });
      this.setPrefs({ subtitlesVisible: true });
      this.toast("ok", `Subtitles loaded: ${file.name}`);
    } catch (err) {
      this.toast("danger", err instanceof Error ? err.message : "Couldn't load those subtitles.");
    }
  }

  clearSubtitles(): void {
    const media = this.store.get().media;
    media?.subtitles?.detach();
    this.patchMedia({ subtitles: null });
  }

  setVolume(volume: number): void {
    const media = this.store.get().media;
    media?.adapter.setVolume(volume);
    if (volume > 0 && media?.adapter.isMuted()) media.adapter.setMuted(false);
    this.setPrefs({ volume, muted: volume === 0 ? this.store.get().prefs.muted : false });
  }

  toggleMute(): void {
    const media = this.store.get().media;
    const muted = !(media?.adapter.isMuted() ?? this.store.get().prefs.muted);
    media?.adapter.setMuted(muted);
    if (!muted) this.engine.unblock();
    this.setPrefs({ muted });
  }

  private release(media: LocalMedia): void {
    this.engine.detach();
    media.subtitles?.detach();
    media.adapter.destroy();
    // Shared sources are plain https URLs; only a local file has an object URL to free.
    if (media.file) URL.revokeObjectURL(media.url);
  }

  private patchMedia(patch: Partial<LocalMedia>): void {
    this.store.set((st) => ({ media: st.media && { ...st.media, ...patch } }));
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  enter(): void {
    this.store.set({ phase: "entering" });
  }

  enterRoom(): void {
    this.unlockAudio();
    this.store.set({ phase: "room" });
    this.maybeAutoCinema();
  }

  backToLobby(): void {
    this.store.set({ phase: "lobby" });
  }

  setTab(tab: PanelTab): void {
    this.store.set((st) => ({ ui: { ...st.ui, tab, unread: tab === "chat" && !st.ui.cinema ? 0 : st.ui.unread } }));
  }

  toggleCinema(force?: boolean): void {
    this.cinemaTouched = true;
    this.store.set((st) => {
      const cinema = force ?? !st.ui.cinema;
      return { ui: { ...st.ui, cinema, unread: !cinema && st.ui.tab === "chat" ? 0 : st.ui.unread } };
    });
  }

  openDialog(dialog: DialogName | null): void {
    this.store.set((st) => ({ ui: { ...st.ui, dialog } }));
  }

  reconnectNow(): void {
    this.conn?.reconnectNow();
  }

  setPrefs(patch: Partial<Prefs>): void {
    const prefs = { ...this.store.get().prefs, ...patch };
    savePrefs(prefs);
    this.store.set({ prefs });
    const media = this.store.get().media;
    const video = media?.adapter.element;
    if (video instanceof HTMLVideoElement && patch.subtitlesVisible !== undefined) {
      setSubtitlesVisible(video, patch.subtitlesVisible);
    }
    if (patch.drift) this.engine.poke();
  }

  dismissToast(id: number): void {
    this.store.set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }));
  }

  toast(tone: Toast["tone"], text: string): void {
    const id = this.seq++;
    this.store.set((st) => ({ toasts: [...st.toasts.slice(-3), { id, tone, text }] }));
    this.later(() => this.dismissToast(id), tone === "danger" ? 7000 : 4500);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private maybeAutoCinema(): void {
    const s = this.store.get();
    // Social while waiting, cinema while watching — unless the viewer chose for themselves.
    if (this.cinemaTouched || s.phase !== "room" || !s.room?.playback.started || s.ui.cinema) return;
    // Desktop has room for both. A phone held sideways is there to watch, and the
    // panel becomes an overlay there, so it should start out of the way.
    const roomy = window.matchMedia("(min-width: 900px)").matches;
    const sideways = window.matchMedia("(max-height: 500px) and (orientation: landscape)").matches;
    if (roomy || sideways) {
      this.store.set((st) => ({ ui: { ...st.ui, cinema: true } }));
    }
  }

  private reportStatus(): void {
    if (!this.welcomed) return;
    const status = this.syncStatus();
    if (status === this.lastStatus) {
      clearTimeout(this.statusTimer);
      this.statusTimer = 0;
      return;
    }
    if (this.statusTimer) return;
    // Only category changes, debounced: keeps the room asleep while everyone is simply synced.
    this.statusTimer = window.setTimeout(() => {
      this.statusTimer = 0;
      const current = this.syncStatus();
      const snap = this.store.get().sync;
      // Drift is measured against a shared position, which a broadcast does not have; lag
      // carries the equivalent information there.
      const drift = snap.live ? null : snap.drift;
      if (current !== this.lastStatus && this.send({ t: "status", sync: current, drift, lag: snap.lag })) {
        this.lastStatus = current;
      }
    }, 1500);
  }

  private syncStatus(): SyncStatus {
    const s = this.store.get();
    if (!s.media) return "idle";
    if (this.comparison()?.match === "mismatch") return "mismatch";
    switch (s.sync.phase) {
      case "catching_up":
      case "blocked":
        return "catching_up";
      case "buffering":
        return "buffering";
      case "idle":
      case "lobby":
        return "idle";
      default:
        return "synced";
    }
  }

  private patchRoom(patch: Partial<RoomSnapshot>): void {
    this.store.set((st) => ({ room: st.room && { ...st.room, ...patch } }));
  }

  private system(text: string): void {
    const item: ChatItem = { kind: "system", id: `sys-${this.seq++}`, text, at: Date.now() };
    this.store.set((st) => ({ chat: [...st.chat, item].slice(-CHAT_KEEP) }));
  }

  private float(emoji: string, name: string | null): void {
    const id = this.seq++;
    const x = 8 + Math.random() * 78;
    this.store.set((st) => ({ floats: [...st.floats.slice(-24), { id, emoji, x, name }] }));
    this.later(() => this.store.set((st) => ({ floats: st.floats.filter((f) => f.id !== id) })), 3000);
  }

  private overlay(item: ChatItem): void {
    this.store.set((st) => ({ overlay: [...st.overlay.slice(-2), item] }));
    this.later(() => this.store.set((st) => ({ overlay: st.overlay.filter((o) => o !== item) })), 6000);
  }

  private send(msg: ClientMessage): boolean {
    return this.conn?.send(msg) ?? false;
  }

  private aid(): string {
    return `a${this.seq++}`;
  }

  private later(fn: () => void, ms: number): void {
    const t = window.setTimeout(() => {
      this.timers.delete(t);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(t);
  }
}
