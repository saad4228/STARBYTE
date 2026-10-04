import { memo, type CSSProperties } from "react";
import { cx } from "../lib/cx";
import { Pixel } from "./Pixel";
import { avatarSprite } from "./sprites";
import "./art.css";

export type AvatarTone = "ok" | "warn" | "danger" | "idle" | "none";

interface AvatarProps {
  seed: number;
  size?: number;
  tone?: AvatarTone;
  /** Soft glow ring, e.g. while someone speaks or reacts. */
  glow?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Deterministic pixel portrait inside a round bubble. Decorative: names are always shown next to it. */
export const Avatar = memo(function Avatar({ seed, size = 32, tone = "none", glow, className, style }: AvatarProps) {
  return (
    <span
      className={cx("avatar", `avatar--${tone}`, glow && "avatar--glow", className)}
      style={{ width: size, height: size, ...style }}
      aria-hidden="true"
    >
      <Pixel sprite={avatarSprite(seed)} scale={0} className="avatar__art" />
    </span>
  );
});
