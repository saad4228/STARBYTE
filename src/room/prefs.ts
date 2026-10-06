import { DEFAULT_DRIFT, type DriftConfig } from "../sync/drift";

/** The range the call faces can be dragged between. */
export const CALL_SIZE_MIN = 36;
export const CALL_SIZE_MAX = 168;

/** Personal preferences. They stay in this browser and never affect anyone else. */
export interface Prefs {
  drift: DriftConfig;
  /** In cinema mode, briefly show new chat messages over the picture. */
  chatOverlay: boolean;
  /** Show other people's reactions over the movie. */
  showReactions: boolean;
  /** Drop the movie volume while someone in the call is talking. */
  duckOnTalk: boolean;
  /** Join the call with the camera on rather than voice only. */
  callVideoDefault: boolean;
  /**
   * How large the faces in the call are drawn, in pixels. Small by default so the film stays
   * the thing you are watching, but entirely yours to change.
   */
  callSize: number;
  notify: {
    presence: boolean;
    playback: boolean;
    sync: boolean;
    connection: boolean;
  };
  volume: number;
  muted: boolean;
  subtitlesVisible: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  drift: DEFAULT_DRIFT,
  chatOverlay: true,
  showReactions: true,
  duckOnTalk: true,
  callVideoDefault: false,
  callSize: 44,
  notify: { presence: true, playback: true, sync: false, connection: true },
  volume: 1,
  muted: false,
  subtitlesVisible: true,
};

const KEY = "starbyte:prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const v = JSON.parse(raw) as Partial<Prefs>;
    const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : d);
    const num = (x: unknown, d: number, min: number, max: number) =>
      typeof x === "number" && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d;
    return {
      drift: {
        ...DEFAULT_DRIFT,
        enabled: bool(v.drift?.enabled, DEFAULT_DRIFT.enabled),
        gentle: bool(v.drift?.gentle, DEFAULT_DRIFT.gentle),
        hardMs: num(v.drift?.hardMs, DEFAULT_DRIFT.hardMs, 250, 3000),
      },
      chatOverlay: bool(v.chatOverlay, DEFAULT_PREFS.chatOverlay),
      showReactions: bool(v.showReactions, DEFAULT_PREFS.showReactions),
      duckOnTalk: bool(v.duckOnTalk, DEFAULT_PREFS.duckOnTalk),
      callVideoDefault: bool(v.callVideoDefault, DEFAULT_PREFS.callVideoDefault),
      callSize: num(v.callSize, DEFAULT_PREFS.callSize, CALL_SIZE_MIN, CALL_SIZE_MAX),
      notify: {
        presence: bool(v.notify?.presence, DEFAULT_PREFS.notify.presence),
        playback: bool(v.notify?.playback, DEFAULT_PREFS.notify.playback),
        sync: bool(v.notify?.sync, DEFAULT_PREFS.notify.sync),
        connection: bool(v.notify?.connection, DEFAULT_PREFS.notify.connection),
      },
      volume: num(v.volume, 1, 0, 1),
      muted: bool(v.muted, false),
      subtitlesVisible: bool(v.subtitlesVisible, true),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Not persisted; fine.
  }
}
