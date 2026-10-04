import type { AdapterEvent, MediaAdapter } from "./adapter";
import { SourceError } from "./errors";

/**
 * YouTube, through the official IFrame Player API.
 *
 * This is the one source that cannot be an `<video>`: YouTube does not hand out media URLs, and
 * scraping one would both break constantly and breach their terms. The embedded player is the
 * sanctioned route, so the adapter's job is to make it answer the same questions as a video
 * element — where are you, how long are you, go here, play, pause.
 *
 * Two things the player genuinely cannot do as well as a file:
 *   - Its clock is coarse. `getCurrentTime` moves in steps of roughly a quarter of a second,
 *     so the sync engine is told to use wider tolerances (`precision: "coarse"`).
 *   - Its playback rate is a fixed menu, not a dial, so the gentle rate nudge is off and
 *     corrections are made by seeking instead.
 */

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoLoadedFraction(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  setVolume(volume: number): void;
  getVolume(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  destroy(): void;
}

interface YTNamespace {
  Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => YTPlayer;
}

// YT player states.
const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;

const API_SRC = "https://www.youtube.com/iframe_api";

declare global {
  interface Window {
    YT?: YTNamespace & { loading?: number };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads the IFrame API once per page, however many players ask for it. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const timer = window.setTimeout(
      () => reject(new Error("YouTube's player did not load. A blocker or a strict network may be stopping it.")),
      15_000,
    );
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube's player loaded but is unusable."));
    };
    if (!document.querySelector(`script[src="${API_SRC}"]`)) {
      const s = document.createElement("script");
      s.src = API_SRC;
      s.async = true;
      s.onerror = () => {
        clearTimeout(timer);
        reject(new Error("YouTube's player could not be reached. A blocker or a strict network may be stopping it."));
      };
      document.head.appendChild(s);
    }
  }).catch((err: unknown) => {
    apiPromise = null; // let a later attempt try again
    throw err;
  });
  return apiPromise;
}

const ID = /^[A-Za-z0-9_-]{11}$/;

/** Pull the video id out of the many shapes a YouTube link takes. */
export function parseYouTubeId(url: URL): string | null {
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0] ?? "";
    return ID.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  const v = url.searchParams.get("v");
  if (v && ID.test(v)) return v;
  // /embed/ID, /v/ID, /shorts/ID, /live/ID
  const m = /^\/(?:embed|v|shorts|live)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
  return m?.[1] ?? null;
}

/** Shown verbatim to whoever pasted the link, so it extends the shared source error. */
export class YouTubeError extends SourceError {}

function describeYouTubeError(code: number): string {
  switch (code) {
    case 2:
      return "YouTube rejected that video id.";
    case 5:
      return "YouTube's player can't play this video in this browser.";
    case 100:
      return "That video is private, deleted, or doesn't exist.";
    case 101:
    case 150:
      return "The owner of that video doesn't allow it to be played outside YouTube, so it can't be used here. Most music videos and films are blocked this way.";
    default:
      return "YouTube couldn't play that video.";
  }
}

/**
 * Build a player inside `host` and wait until it is ready.
 * YouTube requires the target element to be in the document, so `host` must be mounted first.
 */
function createPlayer(
  api: YTNamespace,
  host: HTMLElement,
  videoId: string,
  onState: (state: number) => void,
  onRate: () => void,
  /** Errors that arrive after the player said it was ready — a missing video reports in this order. */
  onLateError: (message: string) => void = () => {},
): Promise<YTPlayer> {
  return new Promise<YTPlayer>((resolve, reject) => {
    const slot = document.createElement("div");
    host.appendChild(slot);
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new YouTubeError("YouTube's player took too long to start."));
      }
    }, 20_000);

    const player = new api.Player(slot, {
      videoId,
      host: "https://www.youtube-nocookie.com",
      playerVars: {
        controls: 0, // STARBYTE drives playback; two sets of controls would fight
        disablekb: 1,
        modestbranding: 1,
        rel: 0,
        iv_load_policy: 3,
        playsinline: 1,
        fs: 0,
      },
      events: {
        onReady: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(player);
        },
        onError: (e: { data: number }) => {
          const message = describeYouTubeError(e.data);
          if (settled) onLateError(message);
          else {
            settled = true;
            clearTimeout(timer);
            reject(new YouTubeError(message));
          }
        },
        onStateChange: (e: { data: number }) => onState(e.data),
        onPlaybackRateChange: () => onRate(),
      },
    });
  });
}

/** Read a video's length (and prove it is embeddable) without showing anything. */
export async function probeYouTube(videoId: string): Promise<{ duration: number }> {
  const api = await loadYouTubeApi();
  const host = document.createElement("div");
  // Off screen rather than display:none — a hidden player may refuse to load metadata.
  host.style.cssText = "position:fixed;left:-9999px;top:0;width:320px;height:180px;opacity:0;pointer-events:none";
  document.body.appendChild(host);
  let player: YTPlayer | null = null;
  // A missing or blocked video says it is ready and only then reports the error, so the real
  // reason has to be picked up here rather than from the create promise.
  let late: string | null = null;
  try {
    player = await createPlayer(
      api,
      host,
      videoId,
      () => {},
      () => {},
      (message) => {
        late = message;
      },
    );
    // Duration is occasionally still 0 at ready; give it a moment to settle.
    let duration = player.getDuration();
    for (let i = 0; i < 20 && !late && (!Number.isFinite(duration) || duration <= 0); i++) {
      await new Promise((r) => setTimeout(r, 150));
      duration = player.getDuration();
    }
    if (late) throw new YouTubeError(late);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new YouTubeError("That video has no fixed length — a live stream can't be synchronised yet.");
    }
    return { duration };
  } finally {
    try {
      player?.destroy();
    } catch {
      /* already gone */
    }
    host.remove();
  }
}

export class YouTubeAdapter implements MediaAdapter {
  readonly kind = "youtube" as const;
  /** The player's clock is coarse, so the sync engine widens its tolerances. */
  readonly precision = "coarse" as const;
  readonly element: HTMLElement;

  private player: YTPlayer | null = null;
  private readonly listeners = new Set<(event: AdapterEvent) => void>();
  private ready: Promise<void> | null = null;
  private state = -1;
  private destroyed = false;
  private pendingVolume = 1;
  private pendingMuted = false;

  constructor(
    private readonly videoId: string,
    private readonly fallbackDuration = 0,
  ) {
    const el = document.createElement("div");
    el.className = "stage__video stage__yt";
    this.element = el;
  }

  /** Creates the player. Must run after the element is on the page. */
  load(): Promise<void> {
    this.ready ??= (async () => {
      const api = await loadYouTubeApi();
      await waitForConnected(this.element);
      if (this.destroyed) return;
      const player = await createPlayer(
        api,
        this.element,
        this.videoId,
        (state) => this.onState(state),
        () => this.emit("ratechange"),
      );
      if (this.destroyed) {
        player.destroy();
        return;
      }
      this.player = player;
      player.setVolume(Math.round(this.pendingVolume * 100));
      if (this.pendingMuted) player.mute();
      else player.unMute();
      this.emit("loadedmetadata");
      this.emit("durationchange");
    })();
    return this.ready;
  }

  private onState(state: number): void {
    const was = this.state;
    this.state = state;
    if (state === PLAYING) {
      this.emit("play");
      this.emit("playing");
    } else if (state === PAUSED) this.emit("pause");
    else if (state === BUFFERING) this.emit("waiting");
    else if (state === ENDED) this.emit("ended");
    if (was === BUFFERING && state === PLAYING) this.emit("seeked");
  }

  private emit(event: AdapterEvent): void {
    this.listeners.forEach((l) => l(event));
  }

  async play(): Promise<void> {
    await this.load();
    const player = this.player;
    if (!player) return;
    player.playVideo();
    // playVideo() reports nothing, so watch the state. If it refuses while unmuted, that is
    // the autoplay policy — raised as NotAllowedError so the engine's muted retry kicks in.
    if (player.isMuted()) return;
    await new Promise((r) => setTimeout(r, 1200));
    if (this.destroyed || this.player !== player) return;
    if (player.getPlayerState() !== PLAYING && player.getPlayerState() !== BUFFERING) {
      throw Object.assign(new Error("Autoplay was blocked."), { name: "NotAllowedError" });
    }
  }

  pause(): void {
    this.player?.pauseVideo();
  }

  seek(time: number): void {
    const duration = this.getDuration();
    this.player?.seekTo(Math.max(0, duration > 0 ? Math.min(time, duration) : time), true);
    // Deliberately silent. Events here are the player telling us what happened, never an echo
    // of what we just told it: the engine ticks on every event, so emitting "seeking" from
    // inside the seek it just requested recurses straight into a blown stack. The player's own
    // buffering/playing transitions report the seek asynchronously, as a <video> does.
  }

  getCurrentTime(): number {
    return this.player?.getCurrentTime() ?? 0;
  }

  getDuration(): number {
    const d = this.player?.getDuration() ?? 0;
    return Number.isFinite(d) && d > 0 ? d : this.fallbackDuration;
  }

  getPlaybackRate(): number {
    return this.player?.getPlaybackRate() ?? 1;
  }

  setPlaybackRate(rate: number): void {
    // Only the menu of rates YouTube offers; anything else is ignored by the player anyway.
    this.player?.setPlaybackRate(rate);
  }

  getBuffered(): number {
    const player = this.player;
    if (!player) return 0;
    const duration = this.getDuration();
    if (duration <= 0) return 0;
    return Math.max(0, player.getVideoLoadedFraction() * duration - player.getCurrentTime());
  }

  isPaused(): boolean {
    return this.state !== PLAYING && this.state !== BUFFERING;
  }

  isSeeking(): boolean {
    return false; // the player does not expose it; buffering covers the visible case
  }

  isBuffering(): boolean {
    return this.state === BUFFERING;
  }

  getVolume(): number {
    return this.player ? this.player.getVolume() / 100 : this.pendingVolume;
  }

  setVolume(volume: number): void {
    this.pendingVolume = Math.max(0, Math.min(1, volume));
    this.player?.setVolume(Math.round(this.pendingVolume * 100));
  }

  isMuted(): boolean {
    return this.player ? this.player.isMuted() : this.pendingMuted;
  }

  setMuted(muted: boolean): void {
    this.pendingMuted = muted;
    if (!this.player) return;
    if (muted) this.player.mute();
    else this.player.unMute();
  }

  subscribe(listener: (event: AdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
    try {
      this.player?.destroy();
    } catch {
      /* already gone */
    }
    this.player = null;
    this.element.remove();
  }
}

/** YouTube needs its target in the document before it will build the iframe. */
function waitForConnected(el: HTMLElement, timeoutMs = 10_000): Promise<void> {
  if (el.isConnected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (el.isConnected) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new YouTubeError("The player never appeared on the page."));
      requestAnimationFrame(tick);
    };
    tick();
  });
}
