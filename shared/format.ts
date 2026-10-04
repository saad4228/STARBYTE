/** 5025.4 → "01:23:45"; under an hour → "23:45" unless `forceHours`. */
export function formatTime(seconds: number, forceHours = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 || forceHours ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 5025.418 → "01:23:45.418" — for the sync telemetry HUD. */
export function formatPrecise(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const ms = Math.floor((seconds % 1) * 1000);
  return `${formatTime(seconds, true)}.${String(ms).padStart(3, "0")}`;
}

/** Human duration difference: 501 → "08:21". */
export function formatDelta(seconds: number): string {
  return formatTime(Math.abs(seconds), Math.abs(seconds) >= 3600);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/**
 * Collapse whitespace, strip control and bidi-override characters, clamp length.
 * Zero-width joiners are kept so multi-part emoji (❤️‍🔥) survive.
 */
export function cleanText(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/[\u0000-\u001f\u007f-\u009f​‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}
