import { useEffect, useState } from "react";

export interface VisitCounts {
  today: number;
  total: number;
  /** UTC date the `today` figure covers. */
  day: string;
}

const SESSION_KEY = "starbyte:counted";

/** One visit per browser session, so refreshes and in-app navigation don't inflate the numbers. */
function alreadyCounted(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return true;
    sessionStorage.setItem(SESSION_KEY, "1");
    return false;
  } catch {
    // Storage blocked (private mode): just read the counters instead of recording.
    return true;
  }
}

let inflight: Promise<VisitCounts | null> | null = null;

/**
 * Records this session's visit (once) and returns the site counters.
 * Shared across callers so several components can show the numbers without extra requests.
 */
export function loadVisits(): Promise<VisitCounts | null> {
  inflight ??= (async () => {
    try {
      const res = await fetch("/api/visits", {
        method: alreadyCounted() ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<VisitCounts>;
      return typeof body.today === "number" && typeof body.total === "number"
        ? { today: body.today, total: body.total, day: String(body.day ?? "") }
        : null;
    } catch {
      return null; // offline or blocked; the counter simply doesn't render
    }
  })();
  return inflight;
}

export function useVisits(): VisitCounts | null {
  const [counts, setCounts] = useState<VisitCounts | null>(null);
  useEffect(() => {
    let alive = true;
    void loadVisits().then((v) => {
      if (alive) setCounts(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return counts;
}

export const formatCount = (n: number) => n.toLocaleString("en-US");
