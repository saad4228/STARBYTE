import { positionAt, type PlaybackState } from "../../shared/protocol";
import type { AdapterEvent, MediaAdapter } from "../media/adapter";
import type { ServerClock } from "./clock";
import { decideDrift, type DriftConfig } from "./drift";

export type SyncPhase =
  | "idle" // no media attached
  | "lobby" // ready check, before the first start
  | "paused"
  | "countdown" // a scheduled start is pending
  | "synced"
  | "catching_up"
  | "buffering"
  | "blocked" // the browser refused to play even muted; needs a tap
  | "ended";

export interface SyncSnapshot {
  phase: SyncPhase;
  /** Where the room is, in media seconds. */
  target: number;
  /** Where this browser is. */
  local: number;
  /** local − target in ms; null when it is not meaningful (countdown, ended). */
  drift: number | null;
  rate: number;
  correction: "none" | "nudge" | "jump";
  countdownMs: number | null;
  buffered: number;
  duration: number;
  /** Playback was muted to satisfy the autoplay policy; the UI offers "tap to unmute". */
  autoMuted: boolean;
}

export const IDLE_SNAPSHOT: SyncSnapshot = {
  phase: "idle",
  target: 0,
  local: 0,
  drift: null,
  rate: 1,
  correction: "none",
  countdownMs: null,
  buffered: 0,
  duration: 0,
  autoMuted: false,
};

export interface EngineDeps {
  clock: ServerClock;
  getPlayback(): PlaybackState | null;
  getConfig(): DriftConfig;
  onSnapshot(snapshot: SyncSnapshot): void;
  /** The room's position passed the end of the media. */
  onEnded(): void;
  /** A hard correction happened; `driftMs` is how far off we were. */
  onJump?(driftMs: number): void;
}

const TICK_MS = 200;
const PAUSED_TOLERANCE_S = 0.05;
/** Right after a start, resume or seek, correct harder: a quick jump beats seconds of catch-up. */
const SETTLE_MS = 3000;
const SETTLE_HARD_MS = 250;

/**
 * Keeps one media adapter on the room's timeline. Network traffic is zero: it only compares
 * the local playhead with the authoritative state extrapolated through the server clock.
 */
export class SyncEngine {
  private adapter: MediaAdapter | null = null;
  private interval = 0;
  private startTimer = 0;
  private unsubscribe: (() => void) | null = null;
  private correcting = false;
  private cooldownUntil = 0;
  private jumps: number[] = [];
  /** Learned seek→playing latency of this device, added to jump targets. */
  private seekLead = 0.08;
  private measuringJump = false;
  /** Learned play()→first-frame latency; scheduled starts call play() this early. */
  private startLead = 0.12;
  private measuringStart = false;
  private blocked = false;
  private autoMuted = false;
  private endedForSeq = -1;
  private playInFlight = false;

  constructor(private readonly deps: EngineDeps) {}

  attach(adapter: MediaAdapter): void {
    this.detach();
    this.adapter = adapter;
    this.unsubscribe = adapter.subscribe((e) => this.onEvent(e));
    this.interval = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  detach(): void {
    clearInterval(this.interval);
    clearTimeout(this.startTimer);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.adapter = null;
    this.deps.onSnapshot(IDLE_SNAPSHOT);
  }

  /** Authoritative state changed: respond now rather than on the next tick. */
  poke(): void {
    this.cooldownUntil = 0;
    this.correcting = false;
    this.tick();
  }

  /** Call from a user gesture: retry playback the browser blocked and restore sound. */
  unblock(): void {
    const a = this.adapter;
    if (!a) return;
    this.blocked = false;
    if (this.autoMuted) {
      a.setMuted(false);
      this.autoMuted = false;
    }
    this.tick();
  }

  tick(): void {
    const a = this.adapter;
    const pb = this.deps.getPlayback();
    if (!a || !pb) {
      this.deps.onSnapshot(IDLE_SNAPSHOT);
      return;
    }

    const now = this.deps.clock.serverNow();
    const duration = a.getDuration();
    const end = duration > 0 ? duration : Number.POSITIVE_INFINITY;
    const local = a.getCurrentTime();
    const target = Math.min(Math.max(0, positionAt(pb, now)), end);
    const emit = (phase: SyncPhase, extra: Partial<SyncSnapshot> = {}) =>
      this.deps.onSnapshot({
        phase,
        target,
        local,
        drift: Math.round((local - target) * 1000),
        rate: a.getPlaybackRate(),
        correction: "none",
        countdownMs: null,
        buffered: a.getBuffered(),
        duration,
        autoMuted: this.autoMuted,
        ...extra,
      });

    if (pb.status === "paused") {
      clearTimeout(this.startTimer);
      if (!a.isPaused()) a.pause();
      this.applyRate(pb.rate);
      if (Math.abs(local - target) > PAUSED_TOLERANCE_S && !a.isSeeking()) a.seek(target);
      return emit(pb.started ? "paused" : "lobby");
    }

    if (now < pb.anchor) {
      // Countdown or synchronized resume: park on the start frame, then call play() early by
      // this device's learned start latency so the first frame lands on the scheduled moment.
      const remaining = pb.anchor - now;
      const leadMs = this.startLead * 1000;
      clearTimeout(this.startTimer);
      this.applyRate(pb.rate);
      if (remaining <= leadMs) {
        if (a.isPaused() && !a.isSeeking()) {
          this.measuringStart = true;
          this.play();
        }
        return emit("countdown", { countdownMs: remaining, drift: null });
      }
      if (!a.isPaused()) a.pause();
      if (Math.abs(local - pb.position) > PAUSED_TOLERANCE_S && !a.isSeeking()) a.seek(pb.position);
      this.startTimer = window.setTimeout(() => this.tick(), remaining - leadMs);
      return emit("countdown", { countdownMs: remaining, drift: null });
    }

    if (target >= end - 0.05) {
      if (this.endedForSeq !== pb.seq) {
        this.endedForSeq = pb.seq;
        this.deps.onEnded();
      }
      return emit("ended", { drift: null });
    }

    if (this.blocked) return emit("blocked");
    if (a.isPaused()) {
      this.play();
      return emit("catching_up");
    }
    if (a.isSeeking()) return emit("catching_up", { correction: "jump" });
    if (a.isBuffering()) return emit("buffering");
    if (performance.now() < this.cooldownUntil) return emit("catching_up", { correction: "jump" });

    const drift = local - target;
    const cfg = this.deps.getConfig();
    const settling = now - pb.anchor < SETTLE_MS;
    const decision = decideDrift(
      drift,
      pb.rate,
      this.correcting,
      settling ? { ...cfg, hardMs: Math.min(cfg.hardMs, SETTLE_HARD_MS) } : cfg,
    );
    if (decision.kind === "jump") {
      this.jump(target, drift);
      return emit("catching_up", { correction: "jump" });
    }
    this.correcting = decision.kind === "nudge";
    this.applyRate(decision.rate);
    return emit(this.correcting ? "catching_up" : "synced", { correction: this.correcting ? "nudge" : "none" });
  }

  private jump(target: number, drift: number): void {
    const a = this.adapter!;
    const t = performance.now();
    this.jumps = this.jumps.filter((x) => t - x < 20_000);
    this.jumps.push(t);
    // Repeated jumps mean this device can't keep up; back off instead of seeking in a loop.
    const unstable = this.jumps.length >= 4;
    this.correcting = false;
    this.applyRate(this.deps.getPlayback()?.rate ?? 1);
    this.measuringJump = true;
    a.seek(target + this.seekLead);
    this.cooldownUntil = t + (unstable ? 5000 : 1500);
    this.deps.onJump?.(Math.round(drift * 1000));
  }

  private onEvent(e: AdapterEvent): void {
    if (e === "playing" && (this.measuringJump || this.measuringStart)) {
      const pb = this.deps.getPlayback();
      const a = this.adapter;
      if (pb && a && pb.status === "playing") {
        const now = this.deps.clock.serverNow();
        if (this.measuringStart) {
          // How late the first frame was relative to the scheduled moment (negative = early).
          const lag = ((now - pb.anchor) / 1000) * pb.rate - (a.getCurrentTime() - pb.position);
          this.startLead = Math.min(0.6, Math.max(0, this.startLead + lag * 0.6));
        } else {
          const lag = positionAt(pb, now) - a.getCurrentTime();
          this.seekLead = Math.min(1, Math.max(0, this.seekLead + lag * 0.5));
        }
      }
      this.measuringJump = false;
      this.measuringStart = false;
    }
    if (e === "seeked") this.cooldownUntil = Math.min(this.cooldownUntil, performance.now() + 400);
    if (e !== "ratechange" && e !== "volumechange") this.tick();
  }

  private play(): void {
    const a = this.adapter;
    if (!a || this.playInFlight) return;
    this.playInFlight = true;
    a.play().then(
      () => {
        this.playInFlight = false;
      },
      (err: unknown) => {
        this.playInFlight = false;
        if ((err as { name?: string })?.name !== "NotAllowedError" || this.adapter !== a) return;
        // Autoplay policy: keep everyone in sync silently and let the UI offer "tap to unmute".
        if (!a.isMuted()) {
          a.setMuted(true);
          this.autoMuted = true;
          a.play().catch(() => {
            this.blocked = true;
            this.tick();
          });
        } else {
          this.blocked = true;
          this.tick();
        }
      },
    );
  }

  private applyRate(rate: number): void {
    const a = this.adapter;
    if (a && Math.abs(a.getPlaybackRate() - rate) > 0.0015) a.setPlaybackRate(rate);
  }
}
