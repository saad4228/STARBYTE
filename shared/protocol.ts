/**
 * STARBYTE wire protocol.
 *
 * The room server synchronizes *state and time* — never media bytes. Every frame is a small
 * JSON object tagged with `t`. Both the browser and the room Durable Object import this file,
 * so it must stay free of DOM and Workers types.
 */

export const PROTOCOL_VERSION = 1;

/**
 * Literal heartbeat frame. The Workers runtime answers it on the room's behalf
 * (hibernation auto-response), so keep-alives never wake the Durable Object.
 */
export const HEARTBEAT = "hb";

export type ControlMode = "everyone" | "host";
export type AutoStart = "all" | "most" | "off";
export type PlaybackStatus = "paused" | "playing";
export type SyncStatus = "idle" | "synced" | "catching_up" | "buffering" | "mismatch";

export interface PlaybackState {
  status: PlaybackStatus;
  /** Media position in seconds at `anchor`. */
  position: number;
  /**
   * Server time (ms) that `position` refers to. While playing, an anchor in the future means
   * "start from `position` at exactly this moment" — countdowns and synchronized resumes are
   * just future anchors.
   */
  anchor: number;
  /** Room playback rate. Drift correction nudges on top of this locally. */
  rate: number;
  /** Monotonic version. Clients ignore anything older than what they already have. */
  seq: number;
  /** False until the first start — the room is still in its ready check. */
  started: boolean;
}

export interface MediaFingerprint {
  name: string;
  size: number;
  /** Seconds, always finite. */
  duration: number;
  mime: string;
  width: number;
  height: number;
  /** SHA-256 over the file size and three 1 MiB samples (start, middle, end). Truncated hex. */
  sampleHash: string;
  /** Optional whole-file hash from deep verification. */
  fullHash?: string;
  /** Labels sniffed from the container, e.g. "H.264" and ["AAC", "AC-3"]. */
  videoCodec?: string;
  audioCodecs?: string[];
}

/**
 * A source everyone in the room loads from the same URL, instead of each viewer opening their
 * own copy. The server stores the URL and nothing else — it never fetches or proxies it.
 */
export type RoomSourceKind = "drive" | "link";

export interface RoomSource {
  kind: RoomSourceKind;
  /** Direct, browser-playable https URL. */
  url: string;
  /** What the room shows for it. */
  name: string;
  /** Who put it up. */
  pid: string;
  at: number;
}

/** Where a viewer is in the voice/video call. Null means they never joined it. */
export interface CallState {
  /** Publishing to the call right now. */
  on: boolean;
  /** Camera on (audio-only otherwise). */
  video: boolean;
  /** Mic muted while still in the call. */
  muted: boolean;
}

export interface RoomSettings {
  control: ControlMode;
  /** Start automatically once all (or most) connected viewers are ready. */
  autoStart: AutoStart;
  /** Pause the room when someone drops without leaving. */
  pauseOnDisconnect: boolean;
  /** 3-2-1 countdown on the first start. */
  countdown: boolean;
}

export interface ParticipantPublic {
  id: string;
  name: string;
  /** Seed for the generated pixel avatar. */
  avatar: number;
  host: boolean;
  /** Host-granted playback control (matters when control mode is "host"). */
  granted: boolean;
  online: boolean;
  /** When the participant went offline; null while connected. */
  leftAt: number | null;
  ready: boolean;
  media: MediaFingerprint | null;
  sync: SyncStatus;
  /** Last reported drift in ms (positive = ahead of the room). */
  drift: number | null;
  joinedAt: number;
  call: CallState | null;
}

export interface ChatMessage {
  id: string;
  pid: string;
  name: string;
  text: string;
  at: number;
}

export interface RoomMoment {
  id: string;
  /** Seconds into the media. */
  position: number;
  pid: string;
  name: string;
  emoji: string;
  caption: string;
  at: number;
}

export interface RoomSnapshot {
  id: string;
  name: string;
  createdAt: number;
  settings: RoomSettings;
  /** The room's reference media. Everyone else's file is compared against it. */
  media: MediaFingerprint | null;
  /** Set when the room watches one shared URL instead of everyone's own file. */
  source: RoomSource | null;
  playback: PlaybackState;
  participants: ParticipantPublic[];
  chat: ChatMessage[];
  moments: RoomMoment[];
  maxParticipants: number;
}

/** Public room card served over HTTP before joining. */
export interface RoomInfo {
  id: string;
  name: string;
  hostName: string;
  online: number;
  maxParticipants: number;
  media: { name: string; duration: number } | null;
  started: boolean;
}

export interface CreateRoomRequest {
  name: string;
  hostName: string;
  control: ControlMode;
}

export interface CreateRoomResponse {
  roomId: string;
  hostKey: string;
}

export type PlaybackCauseKind =
  | "play"
  | "pause"
  | "seek"
  | "rate"
  | "start"
  | "autostart"
  | "ended"
  | "disconnect"
  | "media";

export interface PlaybackCause {
  /** Who caused it; null when the server acted on its own (auto-start, disconnect pause). */
  pid: string | null;
  kind: PlaybackCauseKind;
  /** Echo of the client's action id so the sender can reconcile its local prediction. */
  aid?: string;
}

export type ClientMessage =
  | { t: "hello"; v: number; name: string; pid?: string; secret?: string; hostKey?: string }
  | { t: "time"; c: number }
  | { t: "play"; pos: number; aid?: string }
  | { t: "pause"; pos: number; aid?: string }
  | { t: "seek"; pos: number; aid?: string }
  | { t: "rate"; rate: number; aid?: string }
  | { t: "start" }
  | { t: "ready"; ready: boolean }
  | { t: "media"; media: MediaFingerprint | null }
  | { t: "adoptMedia" }
  | { t: "source"; source: { kind: RoomSourceKind; url: string; name: string } | null }
  | { t: "call"; on: boolean; video: boolean; muted: boolean }
  /** Opaque WebRTC signalling (SDP / ICE), relayed verbatim to one peer. */
  | { t: "rtc"; to: string; data: string }
  | { t: "ended" }
  | { t: "chat"; text: string }
  | { t: "react"; emoji: string }
  | { t: "moment"; pos: number; emoji: string; caption: string }
  | { t: "status"; sync: SyncStatus; drift: number | null }
  | { t: "settings"; name?: string; settings?: Partial<RoomSettings> }
  | { t: "grant"; pid: string; control: boolean }
  | { t: "leave" };

export type ServerMessage =
  | { t: "welcome"; pid: string; secret?: string; now: number; room: RoomSnapshot }
  | { t: "time"; c: number; s: number }
  | { t: "playback"; playback: PlaybackState; cause: PlaybackCause | null }
  | { t: "participant"; participant: ParticipantPublic; joined?: boolean }
  | { t: "left"; pid: string }
  | {
      t: "room";
      name: string;
      settings: RoomSettings;
      media: MediaFingerprint | null;
      source: RoomSource | null;
    }
  | { t: "rtc"; from: string; data: string }
  | { t: "chat"; message: ChatMessage }
  | { t: "react"; pid: string; emoji: string }
  | { t: "moment"; moment: RoomMoment }
  | { t: "moments"; moments: RoomMoment[] }
  | { t: "error"; code: ErrorCode; message: string; aid?: string; fatal?: boolean };

export type ErrorCode =
  | "bad_request"
  | "forbidden"
  | "rate_limited"
  | "room_full"
  | "not_found"
  | "capacity"
  | "version"
  | "replaced";

/** WebSocket close codes the server uses. Clients do not auto-reconnect after fatal ones. */
export const CLOSE = {
  stale: 4000,
  replaced: 4001,
  notFound: 4004,
  rateLimited: 4008,
  roomFull: 4009,
  version: 4010,
} as const;

export const FATAL_CLOSE_CODES: ReadonlySet<number> = new Set([
  CLOSE.replaced,
  CLOSE.notFound,
  CLOSE.roomFull,
  CLOSE.version,
]);

/** Where the room is "now", given the authoritative state and the (estimated) server time. */
export function positionAt(playback: PlaybackState, serverNow: number): number {
  if (playback.status !== "playing") return playback.position;
  const elapsed = Math.max(0, serverNow - playback.anchor) / 1000;
  return playback.position + elapsed * playback.rate;
}

export function canControl(
  participant: Pick<ParticipantPublic, "host" | "granted">,
  settings: Pick<RoomSettings, "control">,
): boolean {
  return participant.host || participant.granted || settings.control === "everyone";
}
