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
  /** This room is watching a broadcast: there is an edge rather than a timeline. */
  live: boolean;
  /** Live only: seconds this viewer is behind their own live edge. */
  lag: number | null;
  /** Live only: the newest moment available, in the player's timebase. */
  edge: number;
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
  live: false,
  lag: null,
  edge: 0,
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
 * Below this, two people watching the same frame cannot tell they are apart — roughly the
 * offset you would get from sitting a few metres further from the screen. A correction this
 * small is reported as synced rather than as catching up.
 */
const IMPERCEPTIBLE_MS = 250;

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
    /**
     * A live room has no shared position to aim at — two viewers who tuned in at different
     * moments hold different numbers for the same frame. What they can share is a distance
     * behind the newest moment each of them has, so the target is measured from the edge.
     */
    const live = pb.lag !== null && a.isLive();
    const edge = live ? a.getLiveEdge() : 0;
    const liveTarget = Math.max(0, edge - (pb.lag ?? 0));
    const target = live
      ? // Before the first segments land there is no edge yet; stay where we are rather than
        // aiming at a number that is not one.
        (Number.isFinite(liveTarget) ? liveTarget : local)
      : Math.min(Math.max(0, positionAt(pb, now)), end);
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
        live,
        lag: live && Number.isFinite(edge) ? Math.max(0, edge - local) : null,
        edge: Number.isFinite(edge) ? edge : 0,
        ...extra,
      });

    if (pb.status === "paused") {
      clearTimeout(this.startTimer);
      if (!a.isPaused()) a.pause();
      this.applyRate(pb.rate);
      // Parking on the target frame only makes sense where there is one. A paused broadcast
      // keeps running without us; we rejoin at the edge when the room resumes.
      if (!live && Math.abs(local - target) > PAUSED_TOLERANCE_S && !a.isSeeking()) a.seek(target);
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

    if (!live && target >= end - 0.05) {
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
    /**
     * A stream with no DVR cannot be made to sit further back than it already is — the older
     * data simply is not there to rewind into. Sitting closer to the edge than the room's
     * nominal delay is then the best available position, not an error, and deliberately
     * slowing everyone down for a minute to manufacture the gap would be worse than useless.
     * Only falling behind is worth correcting.
     */
    if (live && !a.canSeek() && drift > 0) {
      this.correcting = false;
      this.applyRate(pb.rate);
      return emit("synced");
    }
    let cfg = this.deps.getConfig();
    // An embedded player reports its position in coarse steps and only accepts a fixed menu
    // of speeds. Chasing 40ms there would mean nudging the rate against measurement noise
    // forever, so widen the band and correct by seeking instead.
    if (a.precision === "coarse") {
      cfg = { ...cfg, gentle: false, deadbandMs: Math.max(cfg.deadbandMs, 400), hardMs: Math.max(cfg.hardMs, 1200) };
    }
    if (live) {
      // The edge itself jitters as segments arrive, so chasing it tightly would mean seeking
      // every few seconds. Hold a loose band and let the rate do the work — and where the
      // stream cannot be scrubbed at all, the rate is the only tool there is.
      cfg = {
        ...cfg,
        gentle: true,
        deadbandMs: Math.max(cfg.deadbandMs, 500),
        hardMs: a.canSeek() ? Math.max(cfg.hardMs, 5000) : Number.POSITIVE_INFINITY,
        maxAdjust: Math.max(cfg.maxAdjust, 0.08),
      };
    }
    const settling = now - pb.anchor < SETTLE_MS;
    const decision = decideDrift(
      drift,
      pb.rate,
      this.correcting,
      settling && a.precision !== "coarse" ? { ...cfg, hardMs: Math.min(cfg.hardMs, SETTLE_HARD_MS) } : cfg,
    );
    if (decision.kind === "jump") {
      this.jump(target, drift);
      return emit("catching_up", { correction: "jump" });
    }
    this.correcting = decision.kind === "nudge";
    this.applyRate(decision.rate);
    // A gentle nudge closes the last fraction of a second at a few percent of real time, which
    // can take ten seconds or more. Calling that "catching up" the whole while reads as though
    // playback is stuck, when the viewer is already closer to the room than anyone could
    // perceive. Below the perceptible threshold the room is synced; the correction continues
    // quietly underneath, and the sync panel still shows the exact figure.
    const perceptible = Math.abs(drift) * 1000 > IMPERCEPTIBLE_MS;
    return emit(this.correcting && perceptible ? "catching_up" : "synced", {
      correction: this.correcting ? "nudge" : "none",
    });
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
