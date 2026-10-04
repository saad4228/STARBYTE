import { memo, type CSSProperties } from "react";
import { spriteLayers, type Sprite } from "./engine";

interface PixelProps {
  sprite: Sprite;
  /** CSS pixels per art pixel. Pass 0 to size the SVG with CSS instead. */
  scale?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible name. Without one the art is decorative and hidden from assistive tech. */
  title?: string;
  /** Optional class per palette key, so parts (eyes, lights) can be animated with CSS. */
  partClass?: Readonly<Record<string, string>>;
}

/** Memoized: sprite layers are cached, and these redraw on every parent state change otherwise. */
export const Pixel = memo(function Pixel({ sprite, scale = 4, className, style, title, partClass }: PixelProps) {
  const layers = spriteLayers(sprite);
  return (
    <svg
      viewBox={`0 0 ${sprite.w} ${sprite.h}`}
      width={scale ? sprite.w * scale : undefined}
      height={scale ? sprite.h * scale : undefined}
      shapeRendering="crispEdges"
      className={className}
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {layers.map((layer) => (
        <path key={layer.key} d={layer.d} fill={layer.fill} className={partClass?.[layer.key]} />
      ))}
    </svg>
  );
});
