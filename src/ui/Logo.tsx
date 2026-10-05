import { sprite } from "../art/engine";
import { Pixel } from "../art/Pixel";
import { Link } from "../lib/router";

export const logoStar = sprite(
  [
    "....p....",
    "....p....",
    "...pLp...",
    "..pLWLp..",
    "ppLWWWLpp",
    "..pLWLp..",
    "...pLp...",
    "....p....",
    "....p....",
  ],
  { p: "#8b5cf6", L: "#b784ff", W: "#ffffff" },
);

interface LogoProps {
  to?: string;
  compact?: boolean;
  className?: string;
}

/**
 * ★ STARBYTE / WATCH PARTY — the brand lockup.
 *
 * The wordmark is readable rather than hidden behind a label. Someone driving the page by
 * voice says what they can see, so the name the browser reports has to contain the words on
 * screen; an aria-label that replaced them meant "click STARBYTE" matched nothing.
 */
export function Logo({ to = "/", compact, className }: LogoProps) {
  return (
    <Link to={to} className={className ? `logo ${className}` : "logo"}>
      <Pixel sprite={logoStar} scale={compact ? 3 : 4} className="logo__mark" />
      {!compact && (
        <span className="logo__words">
          <span className="logo__name">STARBYTE</span> <span className="logo__sub">WATCH PARTY</span>
        </span>
      )}
      <span className="visually-hidden">{compact ? "STARBYTE Watch Party — home" : " — home"}</span>
    </Link>
  );
}
