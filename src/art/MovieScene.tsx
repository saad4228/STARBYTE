import { memo, useId } from "react";
import { cx } from "../lib/cx";
import { mulberry32 } from "./engine";
import "./art.css";

/**
 * The "film" that plays inside every fake screen on the landing page: an original pixel
 * synthwave sunset (or a match on a pitch). Pure SVG + CSS animation, paused on demand.
 */

interface MovieSceneProps {
  variant?: "sunset" | "pitch";
  playing?: boolean;
  className?: string;
}

/** Stepped mountain ridge as a pixel staircase path. */
function ridge(seed: number, base: number, amp: number, step: number): string {
  const rand = mulberry32(seed);
  let d = `M0 90V${base}`;
  let h = base - amp * rand();
  for (let x = 0; x <= 160; x += step) {
    h = Math.max(base - amp, Math.min(base, h + (rand() - 0.5) * amp * 0.9));
    const y = Math.round(h);
    d += `V${y}H${x + step}`;
  }
  return `${d}V90Z`;
}

const FAR = ridge(3, 58, 18, 4);
const NEAR = ridge(11, 60, 10, 3);
/**
 * Stars are twinkled in three groups rather than individually: 3 running animations per scene
 * instead of 26, which matters because several scenes are on the page at once.
 */
const STAR_GROUPS = [0, 1, 2].map((group) =>
  Array.from({ length: 26 }, (_, i) => {
    const rand = mulberry32(i * 31 + 5);
    return { i, x: Math.floor(rand() * 160), y: Math.floor(rand() * 34), big: rand() > 0.8 };
  }).filter((_, i) => i % 3 === group),
);

export const MovieScene = memo(function MovieScene({ variant = "sunset", playing = true, className }: MovieSceneProps) {
  const id = useId().replace(/:/g, "");
  return variant === "pitch" ? (
    <Pitch playing={playing} className={className} />
  ) : (
    <svg
      viewBox="0 0 160 90"
      preserveAspectRatio="xMidYMid slice"
      shapeRendering="crispEdges"
      className={cx("movie", !playing && "is-paused", className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#140833" />
          <stop offset="0.42" stopColor="#4a1a73" />
          <stop offset="0.74" stopColor="#b23c7d" />
          <stop offset="1" stopColor="#ff9259" />
        </linearGradient>
        <linearGradient id={`${id}sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2a8" />
          <stop offset="0.55" stopColor="#ffb84d" />
          <stop offset="1" stopColor="#ff5f8f" />
        </linearGradient>
        <clipPath id={`${id}bands`}>
          <rect x="0" y="0" width="160" height="44" />
          <rect x="0" y="45" width="160" height="3" />
          <rect x="0" y="49.5" width="160" height="2.5" />
          <rect x="0" y="53.5" width="160" height="2" />
          <rect x="0" y="57" width="160" height="1.5" />
        </clipPath>
      </defs>

      <rect width="160" height="62" fill={`url(#${id}sky)`} />
      {STAR_GROUPS.map((stars, g) => (
        <g key={g} className="movie__star" style={{ animationDelay: `${-g * 1.13}s` }}>
          {stars.map((s) => (
            <rect key={s.i} x={s.x} y={s.y} width={s.big ? 2 : 1} height={s.big ? 2 : 1} fill="#f5f1ff" />
          ))}
        </g>
      ))}

      <g clipPath={`url(#${id}bands)`}>
        <circle className="movie__sun" cx="80" cy="44" r="19" fill={`url(#${id}sun)`} />
      </g>

      <g className="movie__ship">
        <rect x="0" y="16" width="6" height="2" fill="#f5f1ff" />
        <rect x="2" y="15" width="2" height="1" fill="#b784ff" />
        <rect x="-6" y="16.5" width="6" height="1" fill="#ffb84d" opacity="0.8" />
      </g>

      <path d={FAR} fill="#3b1466" />
      <path d={NEAR} fill="#22093f" />
      <rect y="60" width="160" height="30" fill="#12052a" />

      <g stroke="#ff4fa3" strokeWidth="0.6" opacity="0.75">
        {Array.from({ length: 13 }, (_, i) => (
          <line key={i} x1="80" y1="60" x2={80 + (i - 6) * 30} y2="90" />
        ))}
      </g>
      <g className="movie__grid" stroke="#ff4fa3" strokeWidth="0.6">
        {Array.from({ length: 6 }, (_, i) => (
          <line key={i} x1="0" x2="160" y1="60" y2="60" style={{ animationDelay: `${-i * 0.5}s` }} />
        ))}
      </g>
      <rect y="60" width="160" height="1" fill="#ff8fc7" opacity="0.9" />
    </svg>
  );
});

const PLAYERS = [
  { x: 40, y: 30, team: "a", dx: 10, dy: 6, t: 5.5 },
  { x: 55, y: 55, team: "a", dx: -8, dy: 8, t: 6.2 },
  { x: 70, y: 40, team: "a", dx: 12, dy: -5, t: 4.8 },
  { x: 90, y: 28, team: "b", dx: -10, dy: 7, t: 5.1 },
  { x: 100, y: 52, team: "b", dx: 9, dy: -9, t: 6.6 },
  { x: 118, y: 42, team: "b", dx: -12, dy: 5, t: 4.4 },
  { x: 22, y: 44, team: "a", dx: 3, dy: 4, t: 7 },
  { x: 140, y: 44, team: "b", dx: -3, dy: -4, t: 7.4 },
];

function Pitch({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 160 90"
      preserveAspectRatio="xMidYMid slice"
      shapeRendering="crispEdges"
      className={cx("movie movie--pitch", !playing && "is-paused", className)}
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={i * 20} width="20" height="90" fill={i % 2 ? "#14503f" : "#176049"} />
      ))}
      <g fill="none" stroke="#bfe8d6" strokeWidth="0.8" opacity="0.85">
        <rect x="6" y="6" width="148" height="78" />
        <line x1="80" y1="6" x2="80" y2="84" />
        <circle cx="80" cy="45" r="11" />
        <rect x="6" y="28" width="16" height="34" />
        <rect x="138" y="28" width="16" height="34" />
      </g>
      {PLAYERS.map((p, i) => (
        <g
          key={i}
          className="movie__player"
          style={{
            animationDuration: `${p.t}s`,
            ["--dx" as string]: `${p.dx}px`,
            ["--dy" as string]: `${p.dy}px`,
          }}
        >
          <rect x={p.x} y={p.y} width="3" height="4" fill={p.team === "a" ? "#b784ff" : "#ffb84d"} />
          <rect x={p.x} y={p.y - 2} width="3" height="2" fill="#e9c9a8" />
        </g>
      ))}
      <rect className="movie__ball" x="78" y="44" width="2" height="2" fill="#ffffff" />
    </svg>
  );
}
