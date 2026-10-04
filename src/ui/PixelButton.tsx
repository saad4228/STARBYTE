import type { AnchorHTMLAttributes, ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "../lib/cx";
import { Link } from "../lib/router";

type Variant = "primary" | "ghost" | "warm" | "danger";
type Size = "sm" | "md" | "lg";

interface Common {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: ReactNode;
  iconEnd?: ReactNode;
  children: ReactNode;
  className?: string;
}

function classes({ variant = "primary", size = "md", block, className }: Omit<Common, "children">) {
  return cx("pbtn", `pbtn--${variant}`, size !== "md" && `pbtn--${size}`, block && "pbtn--block", className);
}

/** The signature STARBYTE button: notched pixel face, hard drop shadow, pixel type. */
export function PixelButton(props: Common & Omit<ComponentPropsWithRef<"button">, "children">) {
  const { variant, size, block, icon, iconEnd, children, className, type = "button", ...rest } = props;
  return (
    <button type={type} className={classes({ variant, size, block, className })} {...rest}>
      <span className="pbtn__face">
        {icon}
        {children}
        {iconEnd}
      </span>
    </button>
  );
}

export function PixelLink(props: Common & { to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children">) {
  const { to, variant, size, block, icon, iconEnd, children, className, ...rest } = props;
  return (
    <Link to={to} className={classes({ variant, size, block, className })} {...rest}>
      <span className="pbtn__face">
        {icon}
        {children}
        {iconEnd}
      </span>
    </Link>
  );
}
