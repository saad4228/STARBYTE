import { DURATION_TOLERANCE_S } from "./constants";
import type { MediaFingerprint } from "./protocol";

/**
 * - identical:  whole-file hash matches, or size + sampled-chunk hash match
 * - compatible: different bytes, but durations agree (e.g. two encodes of the same film)
 * - mismatch:   durations disagree — playback would drift apart
 *
 * Matching file names prove nothing and are never used as evidence.
 */
export type MediaMatch = "identical" | "compatible" | "mismatch";

export interface MediaComparison {
  match: MediaMatch;
  /** Seconds, absolute. */
  durationDelta: number;
  sameSize: boolean;
  sameSample: boolean;
  /** null when either side has not run deep verification. */
  sameFull: boolean | null;
}

export function compareMedia(reference: MediaFingerprint, candidate: MediaFingerprint): MediaComparison {
  const durationDelta = Math.abs(reference.duration - candidate.duration);
  const sameSize = reference.size === candidate.size;
  const sameSample = reference.sampleHash === candidate.sampleHash;
  const sameFull =
    reference.fullHash && candidate.fullHash ? reference.fullHash === candidate.fullHash : null;

  let match: MediaMatch;
  if (sameFull === true || (sameFull === null && sameSize && sameSample)) match = "identical";
  else if (durationDelta <= DURATION_TOLERANCE_S) match = "compatible";
  else match = "mismatch";

  return { match, durationDelta, sameSize, sameSample, sameFull };
}
