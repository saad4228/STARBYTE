/**
 * Drift policy — what to do when local playback is not where the room says it should be.
 *
 *   |drift| below the deadband  → hold (nobody can tell)
 *   moderate drift              → nudge playbackRate proportionally (pitch is preserved)
 *   drift at/over the threshold → jump (seek) straight to the room
 *
 * Pure function, so the behaviour is tested exhaustively and tuned without a browser.
 */

export interface DriftConfig {
  /** Master switch: automatic drift correction. */
  enabled: boolean;
  /** Allow gentle playback-rate catch-up for small drift. */
  gentle: boolean;
  /** Below this, do nothing. */
  deadbandMs: number;
  /** At or above this, seek. */
  hardMs: number;
  /** Rate change per second of drift (proportional controller). */
  gain: number;
  /** Largest relative rate change, e.g. 0.05 = ±5%. */
  maxAdjust: number;
}

export const DEFAULT_DRIFT: DriftConfig = {
  enabled: true,
  gentle: true,
  deadbandMs: 40,
  hardMs: 500,
  gain: 0.25,
  maxAdjust: 0.05,
};

export type DriftDecision = { kind: "hold"; rate: number } | { kind: "nudge"; rate: number } | { kind: "jump" };

/**
 * @param drift      seconds; positive means local playback is ahead of the room
 * @param baseRate   the room's playback rate
 * @param correcting whether a nudge is already in progress (hysteresis: finish closer to zero)
 */
export function decideDrift(drift: number, baseRate: number, correcting: boolean, cfg: DriftConfig): DriftDecision {
  if (!cfg.enabled) return { kind: "hold", rate: baseRate };
  const ms = Math.abs(drift) * 1000;
  if (ms >= cfg.hardMs) return { kind: "jump" };
  if (!cfg.gentle) return { kind: "hold", rate: baseRate };
  const threshold = correcting ? cfg.deadbandMs / 2 : cfg.deadbandMs;
  if (ms <= threshold) return { kind: "hold", rate: baseRate };
  const adjust = Math.max(-cfg.maxAdjust, Math.min(cfg.maxAdjust, -drift * cfg.gain));
  return { kind: "nudge", rate: Math.round(baseRate * (1 + adjust) * 1000) / 1000 };
}
