import { DurableObject } from "cloudflare:workers";

export interface VisitCounts {
  today: number;
  total: number;
  /** UTC date the `today` figure covers, as YYYY-MM-DD. */
  day: string;
}

interface Stored {
  day: string;
  today: number;
  total: number;
}

/** One visit per browser session is counted; this caps what a single network can add in a day. */
const MAX_PER_IP_PER_DAY = 30;
/** Keeps the per-day dedupe map bounded on a busy day. */
const MAX_TRACKED_IPS = 20_000;

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * A single global object holding the site's visit counters.
 *
 * Counts live in memory and are flushed to storage, so a burst of visitors costs one write per
 * second rather than one per visitor. Durable Objects give us a consistent counter without a
 * database, and this object is only woken by /api/visits.
 */
export class Stats extends DurableObject<Env> {
  private state: Stored = { day: utcDay(Date.now()), today: 0, total: 0 };
  /** Visits already counted per hashed IP, for the current UTC day only. */
  private seen = new Map<string, number>();
  private dirty = false;
  private flushing: Promise<void> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<Stored>("counts");
      if (saved) this.state = saved;
      this.rollover(Date.now());
    });
  }

  /** Records a visit and returns the updated counts. */
  async hit(ipKey: string): Promise<VisitCounts> {
    const now = Date.now();
    this.rollover(now);

    const used = this.seen.get(ipKey) ?? 0;
    if (used < MAX_PER_IP_PER_DAY) {
      if (this.seen.size < MAX_TRACKED_IPS || used > 0) this.seen.set(ipKey, used + 1);
      this.state.today += 1;
      this.state.total += 1;
      this.dirty = true;
      this.scheduleFlush();
    }
    return this.counts();
  }

  /** Reads the counters without recording anything. */
  async peek(): Promise<VisitCounts> {
    this.rollover(Date.now());
    return this.counts();
  }

  private counts(): VisitCounts {
    return { today: this.state.today, total: this.state.total, day: this.state.day };
  }

  private rollover(now: number): void {
    const day = utcDay(now);
    if (day === this.state.day) return;
    this.state = { day, today: 0, total: this.state.total };
    this.seen.clear();
    this.dirty = true;
    this.scheduleFlush();
  }

  /** Coalesces writes: at most one storage put per second, however many visitors arrive. */
  private scheduleFlush(): void {
    if (this.flushing) return;
    this.flushing = (async () => {
      try {
        await scheduler.wait(1000);
        if (this.dirty) {
          this.dirty = false;
          await this.ctx.storage.put("counts", this.state);
        }
      } finally {
        this.flushing = null;
      }
      // Anything that arrived during the write gets its own flush.
      if (this.dirty) this.scheduleFlush();
    })();
  }
}
