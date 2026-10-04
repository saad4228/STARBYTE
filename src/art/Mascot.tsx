import { memo, type CSSProperties } from "react";
import { cx } from "../lib/cx";
import { Pixel } from "./Pixel";
import { byteBack, byteBlink, byteFront, laptop, popcorn, remote, scarf } from "./sprites";
import "./art.css";

export type MascotPose = "idle" | "remote" | "laptop" | "scarf" | "popcorn" | "back";

interface MascotProps {
  pose?: MascotPose;
  /** CSS pixels per art pixel. */
  scale?: number;
  flip?: boolean;
  /** Idle bob. Disabled automatically under reduced motion. */
  bob?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/** BYTE, the STARBYTE mascot. Used sparingly — one appearance per scene. */
export const Mascot = memo(function Mascot({ pose = "idle", scale = 4, flip, bob = true, className, style, title }: MascotProps) {
  const back = pose === "back";
  return (
    <span
      className={cx("mascot", `mascot--${pose}`, flip && "mascot--flip", bob && "mascot--bob", className)}
      style={{ ["--px" as string]: `${scale}px`, ...style }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <span className="mascot__rig">
        <Pixel sprite={back ? byteBack : byteFront} scale={scale} className="mascot__body" />
        {!back && <Pixel sprite={byteBlink} scale={scale} className="mascot__blink" />}
        {pose === "scarf" && <Pixel sprite={scarf} scale={scale} className="mascot__scarf" />}
        {pose === "remote" && <Pixel sprite={remote} scale={scale} className="mascot__remote" />}
        {pose === "laptop" && <Pixel sprite={laptop} scale={scale} className="mascot__laptop" />}
        {pose === "popcorn" && <Pixel sprite={popcorn} scale={scale} className="mascot__popcorn" />}
      </span>
    </span>
  );
});
