import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Pixel } from "../art/Pixel";
import { sparkle, sparkleSmall } from "../art/sprites";
import { cx } from "../lib/cx";
import { prefersReducedMotion } from "../lib/router";
import type { FloatItem } from "./demo";

interface SectionHeadProps {
  num: string;
  name: string;
  title: ReactNode;
  sub?: ReactNode;
  id: string;
  align?: "left" | "center";
}

/** "01 / THE SCREEN" chapter label + pixel headline. */
export function SectionHead({ num, name, title, sub, id, align = "left" }: SectionHeadProps) {
  return (
    <header className={cx("shead", align === "center" && "shead--center")}>
      <p className="chapter reveal">
        <span className="chapter__num">{num}</span>
        <span className="chapter__rule" aria-hidden="true" />
        <span className="chapter__name">{name}</span>
      </p>
      <h2 id={id} className="shead__title pixel reveal" style={{ ["--d" as string]: 1 }}>
        {title}
      </h2>
      {sub && (
        <p className="shead__sub reveal" style={{ ["--d" as string]: 2 }}>
          {sub}
        </p>
      )}
    </header>
  );
}

/** Emoji that float up and fade. Purely decorative. */
export function FloatLayer({ items, className }: { items: readonly FloatItem[]; className?: string }) {
  return (
    <div className={cx("floats", className)} aria-hidden="true">
      {items.map((f) => (
        <span key={f.id} className="floats__item" style={{ left: `${f.x}%` }}>
          {f.emoji}
        </span>
      ))}
    </div>
  );
}

interface SparklePoint {
  x: string;
  y: string;
  big?: boolean;
  scale?: number;
  delay?: number;
}

export function Sparkles({ points }: { points: readonly SparklePoint[] }) {
  return (
    <>
      {points.map((p, i) => (
        <Pixel
          key={i}
          sprite={p.big ? sparkle : sparkleSmall}
          scale={p.scale ?? 3}
          className="sparkle"
          style={{ left: p.x, top: p.y, animationDelay: `${-(p.delay ?? i * 0.7)}s` } as CSSProperties}
        />
      ))}
    </>
  );
}

/** An invisible waypoint the light trail flows through. `x` is a fraction of the page width. */
export function TrailAnchor({ x, y = "50%" }: { x: number; y?: string }) {
  return <span className="trail-anchor" data-trail={x} style={{ top: y }} aria-hidden="true" />;
}

/**
 * Pauses CSS animations inside sections that are off screen.
 *
 * The page is ~10,000px tall and every chapter animates something; left running, the browser
 * ticks and repaints all of them while you scroll. Pausing the ones you cannot see is the
 * difference between a janky page and a smooth one, and costs nothing visually.
 */
export function useOffscreenAnimationPause(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const scopes = el.querySelectorAll<HTMLElement>("main > section, .footer");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) entry.target.classList.toggle("anim-paused", !entry.isIntersecting);
      },
      { rootMargin: "150px 0px" },
    );
    for (const node of scopes) {
      node.classList.add("anim-paused");
      io.observe(node);
    }
    return () => io.disconnect();
  }, [root]);
}

/** Adds `is-in` to every `.reveal` under root as it scrolls into view. */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const nodes = el.querySelectorAll<HTMLElement>(".reveal");
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      nodes.forEach((n) => n.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [root]);
}

/** True while the element is on screen — used to start and pause section animations. */
export function useInView<T extends Element>(threshold = 0.2): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setInView(!!entry?.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView];
}

/** setInterval that only runs while `active`. */
export function useTicker(active: boolean, ms: number, fn: () => void) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => saved.current(), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}
