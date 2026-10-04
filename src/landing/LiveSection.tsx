import { useRef, useState } from "react";
import { Avatar } from "../art/Avatar";
import { Mascot } from "../art/Mascot";
import { MovieScene } from "../art/MovieScene";
import { Pixel } from "../art/Pixel";
import { crowd, stadium } from "../art/scenes";
import { cx } from "../lib/cx";
import { prefersReducedMotion } from "../lib/router";
import { Badge, Chip } from "../ui/Badge";
import { DEMO_PEOPLE, type FloatItem } from "./demo";
import { FloatLayer, SectionHead, TrailAnchor, useInView, useTicker } from "./parts";

/** 06 / LIVE — the world shifts from cinema to stadium. */
export function LiveSection() {
  const reduced = prefersReducedMotion();
  const [roomRef, inView] = useInView<HTMLDivElement>(0.25);
  const [clock, setClock] = useState(72 * 60 + 31);
  const [score, setScore] = useState<[number, number]>([2, 1]);
  const [energy, setEnergy] = useState(81);
  const [goal, setGoal] = useState(0);
  const [atEdge, setAtEdge] = useState(false);
  const [floats, setFloats] = useState<FloatItem[]>([]);
  const nextId = useRef(1);

  const burst = (emoji: string) => {
    const item = { id: nextId.current++, emoji, x: 6 + Math.random() * 80 };
    setFloats((f) => [...f.slice(-14), item]);
    window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== item.id)), 2900);
  };

  useTicker(inView, 1000, () => {
    setClock((c) => (c >= 90 * 60 ? 46 * 60 : c + 1));
    setEnergy((e) => Math.max(64, e - 1));
  });
  useTicker(inView && !reduced, 9000, () => {
    setGoal((g) => g + 1);
    setScore(([a, b]) => (a >= 5 ? [2, 1] : [a + 1, b]));
    setEnergy(94 + Math.floor(Math.random() * 6));
    ["🔥", "⚽", "🔥", "👏", "🔥"].forEach((e, i) => window.setTimeout(() => burst(e), i * 140));
  });

  const sync = () => {
    setAtEdge(true);
    window.setTimeout(() => setAtEdge(false), 9000);
  };

  const mm = String(Math.floor(clock / 60)).padStart(2, "0");
  const ss = String(clock % 60).padStart(2, "0");

  return (
    <section className="section live" id="live" aria-labelledby="live-title">
      <TrailAnchor x={0.05} y="40%" />
      <div className="live__backdrop" aria-hidden="true">
        <span className="live__flood live__flood--l" />
        <span className="live__flood live__flood--r" />
        <div className="live__stadium">
          <Pixel sprite={stadium()} scale={0} className="live__stands" />
          <Pixel sprite={crowd()} scale={0} className={cx("live__crowd", goal > 0 && "is-cheering")} key={goal} />
        </div>
      </div>

      <div className="container live__grid">
        <div className="live__copy">
          <SectionHead
            num="06"
            name="Live"
            id="live-title"
            title={
              <>
                Movie night. Match night. <em>Any night.</em>
              </>
            }
            sub="Live sources sync around the live edge — not a pretend movie timeline. Paste a stream and the room holds everyone the same distance behind it."
          />
          <ul className="live__points reveal">
            <li>A real ● LIVE edge instead of a scrubber</li>
            <li>See exactly how far behind the room you are</li>
            <li>One tap to sync back to the live room</li>
          </ul>
          <div className="live__foot reveal">
            <Mascot pose="scarf" scale={4} className="live__mascot" />
            <Chip tone="live">Live mode · available</Chip>
          </div>
        </div>

        <div className="frame frame--warm live__room reveal" ref={roomRef}>
          <div className="scoreboard" aria-hidden="true">
            <Badge tone="live" pulse>
              Live
            </Badge>
            <span className="scoreboard__team">Team A</span>
            <span className="scoreboard__score pixel tnum">
              {score[0]} — {score[1]}
            </span>
            <span className="scoreboard__team">Team B</span>
            <span className="scoreboard__clock tnum">
              {mm}:{ss}
            </span>
          </div>
          <div className="live__screen" aria-hidden="true">
            <MovieScene variant="pitch" playing={inView && !reduced} />
            <FloatLayer items={floats} />
            {goal > 0 && (
              <span key={goal} className="goal pixel">
                ⚽ Goal!
              </span>
            )}
            <div className="live__viewers">
              {DEMO_PEOPLE.map((p) => (
                <Avatar key={p.name} seed={p.seed} size={26} tone="ok" />
              ))}
            </div>
          </div>
          <div className="live__bar">
            <span className={cx("live__behind tnum", atEdge && "is-edge")}>
              {atEdge ? "● At the live edge" : "1.8s behind the room"}
            </span>
            <button type="button" className="live__sync" onClick={sync} disabled={atEdge}>
              {atEdge ? "Synced" : "Sync to live room"}
            </button>
          </div>
          <div className="energy">
            <span className="energy__label">Room energy</span>
            <span className="energy__bar" role="meter" aria-label="Room energy" aria-valuenow={energy} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${energy}%` }} />
            </span>
            <span className="energy__val tnum">{energy}%</span>
          </div>
        </div>
      </div>
    </section>
  );
}
