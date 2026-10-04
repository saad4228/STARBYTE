import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export type BadgeTone = "default" | "ok" | "warn" | "danger" | "live" | "muted";

interface BadgeProps {
  tone?: BadgeTone;
  pulse?: boolean;
  /** Hollow dot — "in progress" states. */
  ring?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}

/** HUD status badge: a square status light plus a short uppercase label. */
export function Badge({ tone = "default", pulse, ring, children, className, title }: BadgeProps) {
  return (
    <span className={cx("badge", tone !== "default" && `badge--${tone}`, pulse && "badge--pulse", className)} title={title}>
      <span className={cx("badge__dot", ring && "badge__dot--ring")} aria-hidden="true" />
      {children}
    </span>
  );
}

export function Chip({ tone, children }: { tone?: "live" | "soon"; children: ReactNode }) {
  return <span className={cx("chip", tone && `chip--${tone}`)}>{children}</span>;
}
