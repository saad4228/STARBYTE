import { describe, expect, it } from "vitest";
import { estimateOffset, ServerClock } from "./clock";
import { decideDrift, DEFAULT_DRIFT } from "./drift";

describe("decideDrift", () => {
  const cfg = DEFAULT_DRIFT;

  it("holds inside the deadband", () => {
    expect(decideDrift(0.02, 1, false, cfg)).toEqual({ kind: "hold", rate: 1 });
    expect(decideDrift(-0.039, 1, false, cfg)).toEqual({ kind: "hold", rate: 1 });
  });

  it("speeds up when behind and slows down when ahead, proportionally", () => {
    const behind = decideDrift(-0.1, 1, false, cfg);
    const ahead = decideDrift(0.1, 1, false, cfg);
    expect(behind).toEqual({ kind: "nudge", rate: 1.025 });
    expect(ahead).toEqual({ kind: "nudge", rate: 0.975 });
  });

  it("caps the nudge so playback never sounds wrong", () => {
    expect(decideDrift(-0.45, 1, false, cfg)).toEqual({ kind: "nudge", rate: 1.05 });
    expect(decideDrift(-0.45, 1.5, false, cfg)).toEqual({ kind: "nudge", rate: 1.575 });
  });

  it("jumps at the hard threshold", () => {
    expect(decideDrift(0.5, 1, false, cfg)).toEqual({ kind: "jump" });
    expect(decideDrift(-3, 1, true, cfg)).toEqual({ kind: "jump" });
  });

  it("keeps correcting until well inside the deadband (hysteresis)", () => {
    expect(decideDrift(0.03, 1, false, cfg).kind).toBe("hold");
    expect(decideDrift(0.03, 1, true, cfg).kind).toBe("nudge");
    expect(decideDrift(0.015, 1, true, cfg).kind).toBe("hold");
  });

  it("respects the user's settings", () => {
    expect(decideDrift(0.3, 1, false, { ...cfg, gentle: false })).toEqual({ kind: "hold", rate: 1 });
    expect(decideDrift(5, 1, false, { ...cfg, enabled: false })).toEqual({ kind: "hold", rate: 1 });
    expect(decideDrift(0.3, 1, false, { ...cfg, hardMs: 250 })).toEqual({ kind: "jump" });
  });

  it("converges: simulated playback with a 400 ms lag settles inside the deadband", () => {
    let drift = -0.4;
    let correcting = false;
    let t = 0;
    while (t < 60) {
      const d = decideDrift(drift, 1, correcting, cfg);
      if (d.kind === "jump") throw new Error("should not need to jump");
      correcting = d.kind === "nudge";
      drift += (d.rate - 1) * 0.2; // 200 ms ticks
      t += 0.2;
      if (!correcting && Math.abs(drift) < 0.04) break;
    }
    expect(Math.abs(drift)).toBeLessThan(0.04);
    expect(t).toBeLessThan(25);
  });
});

describe("ServerClock", () => {
  it("estimates offset from round trips, preferring the fastest samples", () => {
    let fake = 1000;
    const clock = new ServerClock(() => fake);
    // Server runs 5 s ahead. A fast sample (20 ms) and a congested one (400 ms, asymmetric).
    clock.addSample(1000, 6010, 1020);
    clock.addSample(1100, 6390, 1500);
    clock.addSample(1600, 6610, 1620);
    expect(clock.ready).toBe(true);
    fake = 2000;
    expect(Math.abs(clock.serverNow() - 7000)).toBeLessThan(70);
  });

  it("ignores stale pongs", () => {
    const clock = new ServerClock(() => 0);
    clock.addSample(0, 999_999, 20_000);
    expect(clock.ready).toBe(false);
    expect(clock.latency).toBeNull();
  });

  it("reports the median recent round trip", () => {
    expect(
      estimateOffset([
        { offset: 0, rtt: 30, at: 0 },
        { offset: 0, rtt: 50, at: 1 },
        { offset: 0, rtt: 500, at: 2 },
      ])?.rtt,
    ).toBe(50);
  });
});
