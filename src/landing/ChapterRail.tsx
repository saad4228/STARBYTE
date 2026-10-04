import { useEffect, useState } from "react";
import { cx } from "../lib/cx";
import { navigate } from "../lib/router";

export const CHAPTERS = [
  { id: "how-it-works", num: "01", name: "Screen" },
  { id: "features", num: "02", name: "Room" },
  { id: "sync", num: "03", name: "Sync" },
  { id: "crowd", num: "04", name: "Crowd" },
  { id: "moments", num: "05", name: "Moments" },
  { id: "live", num: "06", name: "Live" },
  { id: "privacy", num: "07", name: "Privacy" },
] as const;

/** A level-select style progress rail on wide screens. */
export function ChapterRail() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const c of CHAPTERS) {
      const el = document.getElementById(c.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return (
    <nav className={cx("rail", active && "is-visible")} aria-label="Page chapters">
      <ol>
        {CHAPTERS.map((c) => (
          <li key={c.id}>
            <a
              href={`#${c.id}`}
              className={cx("rail__item", active === c.id && "is-active")}
              aria-current={active === c.id ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(`#${c.id}`);
              }}
            >
              <span className="rail__name">{c.name}</span>
              <span className="rail__num">{c.num}</span>
              <span className="rail__gem" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
