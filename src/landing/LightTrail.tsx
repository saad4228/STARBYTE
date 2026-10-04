import { useEffect, useState, type RefObject } from "react";

interface Point {
  x: number;
  y: number;
}

/** Catmull-Rom spline through the waypoints, as cubic Béziers. */
function smoothPath(p: Point[]): string {
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(p[0]!.x)} ${f(p[0]!.y)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/**
 * The STARBYTE light trail: one projector-beam ribbon that weaves through every section,
 * tying the page into a single world. Waypoints are `[data-trail]` anchors inside sections,
 * so the curve follows the real layout at every viewport size.
 */
export function LightTrail({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const [geo, setGeo] = useState<{ w: number; h: number; d: string } | null>(null);

  // Passive effect on purpose: a child's layout effect runs before the parent's ref is attached.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = root.getBoundingClientRect();
        const w = root.clientWidth;
        const h = root.offsetHeight;
        const points = [...root.querySelectorAll<HTMLElement>("[data-trail]")]
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { x: Number(el.dataset.trail) * w, y: r.top - box.top };
          })
          .sort((a, b) => a.y - b.y);
        if (points.length < 2) return;
        // Enter from above the page so the ribbon feels like it began somewhere in the sky.
        points.unshift({ x: w * 1.04, y: -120 });
        setGeo((prev) => {
          const d = smoothPath(points);
          return prev && prev.d === d && prev.w === w && prev.h === h ? prev : { w, h, d };
        });
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    void document.fonts?.ready.then(measure);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [rootRef]);

  if (!geo) return null;
  return (
    <>
      <svg
        className="trail"
        width={geo.w}
        height={geo.h}
        viewBox={`0 0 ${geo.w} ${geo.h}`}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="trail-tint" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={geo.h}>
            <stop offset="0" stopColor="#b784ff" />
            <stop offset="0.62" stopColor="#8b5cf6" />
            <stop offset="0.74" stopColor="#ff7a6b" />
            <stop offset="0.86" stopColor="#b784ff" />
            <stop offset="1" stopColor="#ffd27a" />
          </linearGradient>
        </defs>
        {/* Static strokes only. Anything animated here would invalidate a page-tall layer every frame. */}
        <path d={geo.d} className="trail__band" />
        <path d={geo.d} className="trail__film" />
        <path d={geo.d} className="trail__core" />
      </svg>
      {/* The travelling light is a small element on a motion path: it repaints ~16px, not the page. */}
      <span className="trail__spark" style={{ offsetPath: `path("${geo.d}")` }} aria-hidden="true" />
    </>
  );
}
