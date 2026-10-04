import { useEffect, useState, type RefObject } from "react";
import { prefersReducedMotion } from "../lib/router";

export interface WireLink {
  from: RefObject<HTMLElement | null>;
  to: RefObject<HTMLElement | null>;
}

interface WiresProps {
  container: RefObject<HTMLElement | null>;
  /** Must be referentially stable (create once). */
  links: readonly WireLink[];
  packets?: boolean;
  className?: string;
}

/**
 * Curved connector lines between real elements, with sync "packets" travelling along them.
 * Measured from layout, so the same diagram works side-by-side on desktop and stacked on mobile.
 */
export function Wires({ container, links, packets = true, className }: WiresProps) {
  const [geo, setGeo] = useState<{ w: number; h: number; paths: string[] }>({ w: 0, h: 0, paths: [] });

  // Passive effect on purpose: a child's layout effect runs before the parent's ref is attached.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = el.getBoundingClientRect();
        const paths: string[] = [];
        for (const link of links) {
          const a = link.from.current?.getBoundingClientRect();
          const b = link.to.current?.getBoundingClientRect();
          if (!a || !b) continue;
          const horizontal = b.left >= a.right - 2;
          if (horizontal) {
            const x1 = a.right - box.left;
            const y1 = a.top + a.height / 2 - box.top;
            const x2 = b.left - box.left;
            const y2 = b.top + b.height / 2 - box.top;
            const mx = (x1 + x2) / 2;
            paths.push(`M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`);
          } else {
            const x1 = a.left + a.width / 2 - box.left;
            const y1 = a.bottom - box.top;
            const x2 = b.left + b.width / 2 - box.left;
            const y2 = b.top - box.top;
            const my = (y1 + y2) / 2;
            paths.push(`M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2}`);
          }
        }
        setGeo({ w: box.width, h: box.height, paths });
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    void document.fonts?.ready.then(measure);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [container, links]);

  const animate = packets && !prefersReducedMotion();
  return (
    <>
      <svg
        className={className ? `wires ${className}` : "wires"}
        width={geo.w}
        height={geo.h}
        viewBox={`0 0 ${geo.w || 1} ${geo.h || 1}`}
        aria-hidden="true"
        focusable="false"
      >
        {geo.paths.map((d, i) => (
          <g key={i}>
            <path d={d} className="wires__glow" />
            <path d={d} className="wires__line" />
          </g>
        ))}
      </svg>
      {/*
       * Packets ride the same curves as CSS motion paths rather than SVG <animateMotion>.
       * SMIL is not composited, redraws the whole diagram every frame, and keeps running off
       * screen because animation-play-state does not apply to it.
       */}
      {animate &&
        geo.paths.map((d, i) => (
          <span
            key={i}
            className="wires__packet"
            aria-hidden="true"
            style={{
              offsetPath: `path("${d}")`,
              animationDuration: `${2.4 + (i % 3) * 0.35}s`,
              animationDelay: `${-i * 0.8}s`,
            }}
          />
        ))}
    </>
  );
}
