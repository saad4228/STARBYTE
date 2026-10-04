import type { AdapterEvent, MediaAdapter, SourceKind } from "./adapter";

const FORWARDED: AdapterEvent[] = [
  "loadedmetadata",
  "durationchange",
  "play",
  "pause",
  "playing",
  "waiting",
  "seeking",
  "seeked",
  "ended",
  "ratechange",
  "volumechange",
  "error",
];

/**
 * Adapter over an HTMLVideoElement. Used for local files (object URLs) and, later, any
 * browser-playable direct URL. The element is created here and mounted by the stage, so
 * playback survives React re-renders and screen changes.
 */
export class Html5MediaAdapter implements MediaAdapter {
  readonly element: HTMLVideoElement;
  private readonly listeners = new Set<(event: AdapterEvent) => void>();
  private buffering = false;
  private readonly handlers: [string, EventListener][] = [];

  constructor(
    readonly kind: SourceKind,
    src: string,
    /** Known duration (from analysis) for files whose container omits it. */
    private readonly fallbackDuration = 0,
  ) {
    const v = document.createElement("video");
    v.className = "stage__video";
    v.preload = "auto";
    v.playsInline = true;
    v.controls = false;
    v.disableRemotePlayback = true;
    v.src = src;
    this.element = v;

    for (const type of FORWARDED) {
      const handler = () => {
        if (type === "waiting") this.buffering = true;
        if (type === "playing" || type === "seeked" || type === "pause") this.buffering = false;
        this.listeners.forEach((l) => l(type));
      };
      v.addEventListener(type, handler);
      this.handlers.push([type, handler]);
    }
    const ready = () => {
      this.buffering = false;
    };
    v.addEventListener("canplay", ready);
    this.handlers.push(["canplay", ready]);
  }

  load(): Promise<void> {
    const v = this.element;
    if (v.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => {
        v.removeEventListener("loadedmetadata", done);
        v.removeEventListener("error", fail);
        resolve();
      };
      const fail = () => {
        v.removeEventListener("loadedmetadata", done);
        v.removeEventListener("error", fail);
        reject(new Error(v.error?.message || "This media could not be loaded."));
      };
      v.addEventListener("loadedmetadata", done);
      v.addEventListener("error", fail);
    });
  }

  play(): Promise<void> {
    return this.element.play();
  }

  pause(): void {
    this.element.pause();
  }

  seek(time: number): void {
    const duration = this.getDuration();
    this.element.currentTime = Math.max(0, duration > 0 ? Math.min(time, duration) : time);
  }

  getCurrentTime(): number {
    return this.element.currentTime;
  }

  getDuration(): number {
    const d = this.element.duration;
    return Number.isFinite(d) && d > 0 ? d : this.fallbackDuration;
  }

  getPlaybackRate(): number {
    return this.element.playbackRate;
  }

  setPlaybackRate(rate: number): void {
    this.element.playbackRate = rate;
  }

  getBuffered(): number {
    const v = this.element;
    const t = v.currentTime;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= t + 0.05 && v.buffered.end(i) >= t) return v.buffered.end(i) - t;
    }
    return 0;
  }

  isPaused(): boolean {
    return this.element.paused;
  }

  isSeeking(): boolean {
    return this.element.seeking;
  }

  isBuffering(): boolean {
    const v = this.element;
    return !v.paused && (this.buffering || v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA);
  }

  getVolume(): number {
    return this.element.volume;
  }

  setVolume(volume: number): void {
    this.element.volume = Math.max(0, Math.min(1, volume));
  }

  isMuted(): boolean {
    return this.element.muted;
  }

  setMuted(muted: boolean): void {
    this.element.muted = muted;
  }

  subscribe(listener: (event: AdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    const v = this.element;
    for (const [type, handler] of this.handlers) v.removeEventListener(type, handler);
    this.listeners.clear();
    v.pause();
    v.removeAttribute("src");
    v.load(); // releases the decoder and the file handle
    v.remove();
  }
}
