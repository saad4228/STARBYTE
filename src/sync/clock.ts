/**
 * Server clock estimation, NTP-style.
 *
 * Each ping records when it left (c), the server's clock when it answered (s) and when the
 * pong arrived (r). Assuming symmetric latency, offset = s − (c + rtt/2). Samples with the
 * lowest round-trip time carry the least queuing noise, so the estimate averages the best few.
 */

export interface ClockSample {
  offset: number;
  rtt: number;
  at: number;
}

export function estimateOffset(samples: readonly ClockSample[]): { offset: number; rtt: number } | null {
  if (samples.length === 0) return null;
  const best = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.min(3, samples.length));
  const offset = best.reduce((sum, s) => sum + s.offset, 0) / best.length;
  const recent = samples
    .slice(-5)
    .map((s) => s.rtt)
    .sort((a, b) => a - b);
  return { offset, rtt: recent[Math.floor(recent.length / 2)]! };
}

/** Monotonic wall clock: immune to the system clock being changed mid-movie. */
const monotonicNow = () => performance.timeOrigin + performance.now();

export class ServerClock {
  private samples: ClockSample[] = [];
  private offset = 0;
  private rtt: number | null = null;

  constructor(private readonly now: () => number = monotonicNow) {}

  local(): number {
    return this.now();
  }

  addSample(c: number, s: number, r: number = this.now()): void {
    const rtt = Math.max(0, r - c);
    if (rtt > 10_000) return; // a stale pong after a stall tells us nothing
    this.samples.push({ offset: s - (c + rtt / 2), rtt, at: r });
    const cutoff = r - 10 * 60_000;
    this.samples = this.samples.filter((x) => x.at >= cutoff).slice(-16);
    const est = estimateOffset(this.samples)!;
    this.offset = est.offset;
    this.rtt = est.rtt;
  }

  /** Rough first guess from the welcome frame, replaced as soon as real samples arrive. */
  seed(serverNow: number): void {
    if (this.samples.length === 0) this.offset = serverNow - this.now();
  }

  /** Forget everything, e.g. after the device slept and the monotonic clock paused. */
  reset(): void {
    this.samples = [];
    this.rtt = null;
  }

  serverNow(): number {
    return this.now() + this.offset;
  }

  get ready(): boolean {
    return this.samples.length >= 3;
  }

  get latency(): number | null {
    return this.rtt;
  }

  get offsetMs(): number {
    return this.offset;
  }
}
