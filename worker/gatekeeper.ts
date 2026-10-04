import { DurableObject } from "cloudflare:workers";

export type AdmitVerdict = "ok" | "ip" | "capacity";

const HOUR = 3_600_000;

/**
 * A single global object that rate-limits room creation, so a free deployment can never
 * be run into a bill. It only sees a salted hash of the caller's IP, never the IP itself.
 */
export class Gatekeeper extends DurableObject<Env> {
  private day = "";
  private dayCount = 0;
  private readonly hits = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<{ day: string; count: number }>("day");
      if (saved) {
        this.day = saved.day;
        this.dayCount = saved.count;
      }
    });
  }

  async admit(ipKey: string): Promise<AdmitVerdict> {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.dayCount = 0;
    }

    const perDay = Number(this.env.MAX_ROOMS_PER_DAY) || 2000;
    const perIpHour = Number(this.env.MAX_ROOMS_PER_IP_PER_HOUR) || 12;
    if (this.dayCount >= perDay) return "capacity";

    const recent = (this.hits.get(ipKey) ?? []).filter((t) => now - t < HOUR);
    if (recent.length >= perIpHour) {
      this.hits.set(ipKey, recent);
      return "ip";
    }
    recent.push(now);
    this.hits.set(ipKey, recent);

    if (this.hits.size > 5000) {
      for (const [key, times] of this.hits) if (times.every((t) => now - t >= HOUR)) this.hits.delete(key);
    }

    this.dayCount += 1;
    await this.ctx.storage.put("day", { day: this.day, count: this.dayCount });
    return "ok";
  }
}
