/** Hard limits. They keep rooms small, messages tiny and the deployment inside free-tier quotas. */
export const LIMITS = {
  /** V1 targets 2–5 viewers; a little headroom beyond that. */
  maxParticipants: 8,
  /** Participant records (online + reconnecting) kept per room. */
  maxRecords: 16,
  nameMax: 24,
  roomNameMax: 40,
  chatMax: 500,
  captionMax: 80,
  /** Chat messages persisted per room. */
  chatHistory: 100,
  /** Chat messages sent to a joining viewer. */
  chatSnapshot: 60,
  momentsMax: 200,
  /**
   * The call is a full mesh, so each extra person adds a connection for everyone already in it.
   * Six is where that stays comfortable on a laptop and a phone.
   */
  maxCallers: 6,
  sourceUrlMax: 2048,
  /** Largest single WebRTC signalling payload (one SDP or ICE candidate). */
  rtcPayloadMax: 12 * 1024,
  sourceNameMax: 120,
  /**
   * Largest inbound WebSocket frame accepted by the room. A WebRTC offer carrying both audio
   * and video runs a few KB once JSON-escaped, so this has to clear that with room to spare.
   */
  frameBytes: 16 * 1024,
  /** Largest HTTP body accepted by the API. */
  bodyBytes: 2 * 1024,
} as const;

export const TIMING = {
  /** First start: "READY?" for a beat, then 3 · 2 · 1 · PLAY. */
  countdownMs: 4000,
  /** Every other play/seek-while-playing is scheduled slightly ahead so everyone starts together. */
  resumeLeadMs: 350,
  /** How long a dropped viewer keeps their seat, ready state and media before being removed. */
  reconnectGraceMs: 90_000,
  /** Server sweep for silent disconnects while anyone is online. */
  sweepMs: 3 * 60_000,
  /** A socket with no heartbeat for this long is considered dead. */
  staleSocketMs: 90_000,
  /** Rooms are deleted after this long with nobody connected. */
  roomTtlMs: 24 * 60 * 60_000,
  /** Client heartbeat interval; answered by the runtime without waking the room. */
  heartbeatMs: 25_000,
  /** Client re-measures the server clock this often. */
  clockResyncMs: 3 * 60_000,
} as const;

/** The reaction palette. Order is the on-screen order. */
export const REACTIONS = ["😂", "😭", "😱", "❤️", "🔥", "💀", "👏"] as const;
export type Reaction = (typeof REACTIONS)[number];

export const MOMENT_DEFAULT_EMOJI = "🔥";
export const MOMENT_EMOJI: readonly string[] = [...REACTIONS, "✦"];

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/**
 * Live rooms hold this far behind the edge by default. Far enough that an ordinary buffering
 * hiccup does not drop a viewer out of the window, close enough that nobody feels posted to
 * yesterday — and it is the room's number, so everyone shares the same delay.
 */
export const LIVE_DEFAULT_LAG_S = 8;
/** How close to the edge a controller may pull the room. */
export const LIVE_MIN_LAG_S = 2;
export const LIVE_MAX_LAG_S = 120;
/** Within this of the room's target, a viewer counts as "on the live edge". */
export const LIVE_ON_EDGE_S = 2.5;

/** Two files whose durations differ by more than this are treated as different media. */
export const DURATION_TOLERANCE_S = 2;

/**
 * Public STUN only. There is no TURN here: a relay costs money and would carry every call's
 * audio and video, which is exactly what this project refuses to do with the movie. Mesh P2P
 * connects for the large majority of home networks; symmetric NAT and some corporate firewalls
 * will not, and the UI says so rather than hanging on "connecting".
 */
export const ICE_SERVERS: readonly { urls: string | string[] }[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

/** How long a peer may sit in "connecting" before we call it failed and say so. */
export const CALL_CONNECT_TIMEOUT_MS = 20_000;
