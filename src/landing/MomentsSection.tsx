import { Star } from "lucide-react";
import { useRef, useState } from "react";
import { formatTime } from "../../shared/format";
import { cx } from "../lib/cx";
import { prefersReducedMotion } from "../lib/router";
import { PixelButton } from "../ui/PixelButton";
import { SectionHead, TrailAnchor, useInView, useTicker } from "./parts";

const DURATION = 10153; // 02:49:13

interface Pin {
  id: number;
  t: number;
  emoji: string;
  caption: string;
  by: string;
  mine?: boolean;
}

const INITIAL: Pin[] = [
  { id: 1, t: 2473, emoji: "😂", caption: "the cat. THE CAT.", by: "Zain" },
  { id: 2, t: 5078, emoji: "🔥", caption: "That scene…", by: "Ali" },
  { id: 3, t: 6072, emoji: "😱", caption: "nobody saw that coming", by: "Ahmed" },
  { id: 4, t: 7431, emoji: "😂", caption: "the dad joke", by: "Saad" },
  { id: 5, t: 8240, emoji: "❤️", caption: "ok I'm not crying, you are", by: "Ali" },
];

const MINE = ["🔥", "😭", "👏", "💀"];
const CELLS = 56;
const pct = (t: number) => `${(t / DURATION) * 100}%`;

/** 05 / MOMENTS — a game-style level timeline with save points. */
export function MomentsSection() {
  const reduced = prefersReducedMotion();
  const [trackRef, inView] = useInView<HTMLDivElement>(0.3);
  const [playhead, setPlayhead] = useState(5480);
  const [pins, setPins] = useState(INITIAL);
  const [selected, setSelected] = useState(2);
  const [saves, setSaves] = useState(0);
  const nextId = useRef(100);

  useTicker(inView && !reduced, 80, () => setPlayhead((p) => (p + 12) % DURATION));

  const mark = () => {
    const pin: Pin = {
      id: nextId.current++,
      t: Math.round(playhead),
      emoji: MINE[saves % MINE.length]!,
      caption: "you were here",
      by: "You",
      mine: true,
    };
    setPins((ps) => {
      const mine = ps.filter((p) => p.mine);
      const keep = mine.length >= 3 ? ps.filter((p) => p !== mine[0]) : ps;
      return [...keep, pin];
    });
    setSelected(pin.id);
    setSaves((s) => s + 1);
  };

  const sorted = [...pins].sort((a, b) => a.t - b.t);
  const current = pins.find((p) => p.id === selected);
  const filled = Math.round((playhead / DURATION) * CELLS);

  return (
    <section className="section moments" id="moments" aria-labelledby="moments-title">
      <TrailAnchor x={0.5} y="66%" />
      <div className="container">
        <SectionHead
          align="center"
          num="05"
          name="Moments"
          id="moments-title"
          title={
            <>
              Save the moments that <em>broke the room.</em>
            </>
          }
          sub="Mark a moment. Come back to it later."
        />

        <div className="frame level reveal" ref={trackRef}>
          <div className="level__head">
            <span className="pixel">Room timeline</span>
            <span className="level__dur tnum">
              {formatTime(playhead, true)} <i>/ {formatTime(DURATION, true)}</i>
            </span>
          </div>

          <div className="level__track">
            <div className="level__cells" aria-hidden="true">
              {Array.from({ length: CELLS }, (_, i) => (
                <i key={i} className={i < filled ? "is-on" : undefined} />
              ))}
            </div>
            <span className="level__playhead" style={{ left: pct(playhead) }} aria-hidden="true" />
            {sorted.map((p) => (
              <button
                key={p.id}
                type="button"
                className={cx("pin", p.id === selected && "is-active", p.mine && "is-mine")}
                style={{ left: pct(p.t) }}
                onClick={() => setSelected(p.id)}
                aria-pressed={p.id === selected}
                aria-label={`${p.emoji} at ${formatTime(p.t, true)}: ${p.caption}, marked by ${p.by}`}
              >
                <span className="pin__emoji">{p.emoji}</span>
                <span className="pin__time tnum">{formatTime(p.t, true)}</span>
              </button>
            ))}
          </div>

          <div className="level__foot">
            {current && (
              <div key={current.id} className="savecard" aria-live="polite">
                <span className="savecard__emoji">{current.emoji}</span>
                <div>
                  <p className="savecard__time tnum">{formatTime(current.t, true)}</p>
                  <p className="savecard__caption">“{current.caption}”</p>
                  <p className="savecard__by">Marked by {current.by}</p>
                </div>
              </div>
            )}
            <div className="level__action">
              {saves > 0 && (
                <span key={saves} className="saved-pop pixel" aria-hidden="true">
                  ✦ Moment saved
                </span>
              )}
              <PixelButton onClick={mark} icon={<Star size={16} strokeWidth={2.5} />}>
                Mark moment
              </PixelButton>
            </div>
          </div>
        </div>

        <ol className="ledger reveal" aria-label="Moments in this room">
          {sorted.map((p) => (
            <li key={p.id} className={cx(p.id === selected && "is-active")}>
              <span className="ledger__time tnum">{formatTime(p.t, true)}</span>
              <span className="ledger__emoji" aria-hidden="true">
                {p.emoji}
              </span>
              <span className="ledger__caption">{p.caption}</span>
              <span className="ledger__by">{p.by}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
