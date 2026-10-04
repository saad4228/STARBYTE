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

/** ★ STARBYTE / WATCH PARTY — the brand lockup. */
export function Logo({ to = "/", compact, className }: LogoProps) {
  return (
    <Link to={to} className={className ? `logo ${className}` : "logo"} aria-label="STARBYTE Watch Party — home">
      <Pixel sprite={logoStar} scale={compact ? 3 : 4} className="logo__mark" />
      {!compact && (
        <span className="logo__words" aria-hidden="true">
          <span className="logo__name">STARBYTE</span>
          <span className="logo__sub">WATCH PARTY</span>
        </span>
      )}
    </Link>
  );
}
