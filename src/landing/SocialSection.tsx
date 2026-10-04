import { useRef, useState } from "react";
import { REACTIONS } from "../../shared/constants";
import { Avatar } from "../art/Avatar";
import { MovieScene } from "../art/MovieScene";
import { Pixel } from "../art/Pixel";
import { icons, viewerLook, viewerSprite } from "../art/sprites";
import { prefersReducedMotion } from "../lib/router";
import { Chip } from "../ui/Badge";
import type { FloatItem } from "./demo";
import { FloatLayer, SectionHead, TrailAnchor, useInView, useTicker } from "./parts";

const LAUGHERS = [21, 9, 15].map((seed) => viewerSprite(viewerLook(seed)));

/** 04 / THE CROWD — not a feature grid: four verbs orbiting one screen. */
export function SocialSection() {
  const reduced = prefersReducedMotion();
  const [screenRef, inView] = useInView<HTMLDivElement>(0.2);
  const [floats, setFloats] = useState<FloatItem[]>([]);
  const [combo, setCombo] = useState(0);
  const nextId = useRef(1);
  const lastHit = useRef(0);

  const burst = (emoji: string, byVisitor = false) => {
    const item = { id: nextId.current++, emoji, x: 8 + Math.random() * 76 };
    setFloats((f) => [...f.slice(-16), item]);
    window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== item.id)), 2900);
    if (byVisitor) {
      const now = performance.now();
      setCombo((c) => (now - lastHit.current < 1200 ? c + 1 : 1));
      lastHit.current = now;
    }
  };

  useTicker(inView && !reduced, 1500, () => burst(REACTIONS[Math.floor(Math.random() * REACTIONS.length)]!));

  return (
    <section className="section crowd" id="crowd" aria-labelledby="crowd-title">
      <TrailAnchor x={0.92} y="56%" />
      <div className="container">
        <SectionHead
          align="center"
          num="04"
          name="The crowd"
          id="crowd-title"
          title={
            <>
              Don't just watch. <em>React.</em>
            </>
          }
          sub="Talk, laugh, panic, celebrate — together, on the same frame."
        />

        <div className="crowd__grid">
          <div className="verb verb--talk reveal">
            <span className="verb__word pixel">Talk</span>
            <div className="verb__art talk-art" aria-hidden="true">
              <span className="talk-art__bubble">
                <Avatar seed={5521} size={52} glow />
                <i />
                <i />
              </span>
              <Pixel sprite={icons.mic} scale={3} />
            </div>
            <p className="verb__body">Voice and camera as floating bubbles — never a meeting grid.</p>
            <Chip tone="live">Available</Chip>
          </div>

          <div className="crowd__screen reveal" ref={screenRef}>
            <div className="crowd__frame">
              <MovieScene playing={inView && !reduced} />
              <FloatLayer items={floats} />
              {combo > 1 && (
                <span key={combo} className="combo pixel" aria-live="polite">
                  Combo ×{combo}
                </span>
              )}
            </div>
          </div>

          <div className="verb verb--react reveal" style={{ ["--d" as string]: 1 }}>
            <span className="verb__word pixel">React</span>
            <div className="verb__art react-art" role="group" aria-label="Send a reaction to the preview screen">
              {REACTIONS.map((e) => (
                <button key={e} type="button" onClick={() => burst(e, true)} aria-label={`React with ${e}`}>
                  {e}
                </button>
              ))}
            </div>
            <p className="verb__body">Seven reactions, one tap. They rise over the movie and fade away.</p>
          </div>

          <div className="verb verb--laugh reveal" style={{ ["--d" as string]: 2 }}>
            <span className="verb__word pixel">Laugh</span>
            <div className="verb__art laugh-art" aria-hidden="true">
              {LAUGHERS.map((s, i) => (
                <Pixel key={i} sprite={s} scale={4} className="laugh-art__viewer" />
              ))}
            </div>
            <p className="verb__body">Watch the whole room lose it at the same punchline.</p>
          </div>

          <div className="verb verb--share reveal" style={{ ["--d" as string]: 3 }}>
            <span className="verb__word pixel">Share</span>
            <div className="verb__art share-art" aria-hidden="true">
              <p className="share-art__msg">
                <b>ALI</b> this scene 💀
              </p>
              <p className="share-art__sys">🔥 Ali marked a moment</p>
            </div>
            <p className="verb__body">Chat, moments and inside jokes stay with the room.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
