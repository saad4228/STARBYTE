import { ArrowRight, MessageSquare, Pause, Play, Sparkles as SparklesIcon, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { formatTime } from "../../shared/format";
import { Avatar } from "../art/Avatar";
import { Mascot } from "../art/Mascot";
import { MovieScene } from "../art/MovieScene";
import { Pixel } from "../art/Pixel";
import { moon, skyline } from "../art/scenes";
import { icons, projector, sparkleSmall, viewerLook, viewerSprite } from "../art/sprites";
import { cx } from "../lib/cx";
import { prefersReducedMotion } from "../lib/router";
import { PixelLink } from "../ui/PixelButton";
import { DEMO_PEOPLE, demo, useDemo, type BootPhase } from "./demo";
import { FloatLayer, Sparkles, TrailAnchor } from "./parts";

const AUDIENCE = [3, 11, 7].map((seed) => viewerSprite(viewerLook(seed)));
const DUST = Array.from({ length: 14 }, (_, i) => ({
  left: `${8 + ((i * 37) % 80)}%`,
  top: `${10 + ((i * 53) % 80)}%`,
  delay: `${-(i * 0.9)}s`,
  dur: `${6 + (i % 5)}s`,
}));

export function Hero() {
  useEffect(() => {
    demo.start();
    return () => demo.stop();
  }, []);

  return (
    <section className="hero" aria-labelledby="hero-title">
      <TrailAnchor x={0.62} y="88%" />
      <div className="container hero__grid">
        <div className="hero__copy">
          <p className="eyebrow hero__eyebrow">
            <Pixel sprite={sparkleSmall} scale={3} />
            Multiplayer watch party
          </p>
          <h1 id="hero-title" className="hero__title pixel">
            <span className="hero__line">Your screen.</span>
            <span className="hero__line">Their</span>
            <span className="hero__line">reactions.</span>
            <span className="hero__line hero__line--accent">
              Watch t
              <span className="hero__o" aria-hidden="true">
                <Pixel sprite={sparkleSmall} scale={0} />
              </span>
              <span className="visually-hidden">o</span>gether.
            </span>
          </h1>
          <p className="hero__lede">
            Movies, videos and live streams — shared with the people you want around. Your movie stays on your device;
            STARBYTE keeps everyone on the same frame.
          </p>
          <div className="hero__ctas">
            <PixelLink to="/create" size="lg" iconEnd={<ArrowRight size={18} strokeWidth={2.5} />}>
              Enter cinema
            </PixelLink>
            <PixelLink to="/join" size="lg" variant="ghost">
              Join a room
            </PixelLink>
          </div>
          <ul className="hero__sources" aria-label="Media sources">
            <li className="is-live">
              <Pixel sprite={icons.local} scale={2} />
              Local
            </li>
            <li className="is-live">
              <Pixel sprite={icons.cloud} scale={2} />
              Drive
            </li>
            <li className="is-live">
              <Pixel sprite={icons.stream} scale={2} />
              Link
            </li>
          </ul>
        </div>
        <HeroScene />
      </div>
    </section>
  );
}

function HeroScene() {
  const d = useDemo();
  return (
    <div className="scene" aria-hidden="true">
      <div className="scene__sky" />
      <Pixel sprite={moon()} scale={0} className="scene__moon" />
      <Sparkles
        points={[
          { x: "8%", y: "6%", big: true },
          { x: "48%", y: "2%" },
          { x: "70%", y: "30%" },
          { x: "3%", y: "44%" },
          { x: "93%", y: "48%", big: true, scale: 2 },
        ]}
      />
      <div className="scene__beam">
        {DUST.map((p, i) => (
          <i key={i} style={{ left: p.left, top: p.top, animationDelay: p.delay, animationDuration: p.dur }} />
        ))}
      </div>

      <div className="scene__screen">
        <FakeRoom />
      </div>

      <Pixel sprite={skyline()} scale={0} className="scene__city" />
      <div className="scene__ledge" />
      <div className="scene__audience">
        {AUDIENCE.map((s, i) => (
          <Pixel key={i} sprite={s} scale={0} className="scene__viewer" />
        ))}
      </div>
      <Pixel sprite={projector} scale={0} className="scene__projector" />
      <span className="scene__lens" />
      <Mascot pose="remote" scale={4} className="scene__mascot" />
      {d.moments > 0 && <span key={d.moments} className="scene__save">✦ SAVED</span>}
    </div>
  );
}

const BOOT_TEXT: Record<BootPhase, string> = {
  connecting: "CONNECTING",
  analyzing: "ANALYZING MEDIA",
  syncing: "SYNCING CLOCKS",
  synced: "SYNCED",
};
const BOOT_ORDER: BootPhase[] = ["connecting", "analyzing", "syncing", "synced"];

function FakeRoom() {
  const d = useDemo();
  const progress = ((d.time - 5060) / 120 + 0.62) % 1;
  return (
    <div className="fake">
      <div className="fake__bar">
        <span className="fake__brand">★ STARBYTE</span>
        <span className="fake__room">ROOM 7F21</span>
        <span className="fake__online">
          <i /> {d.viewers} ONLINE
        </span>
      </div>
      <div className="fake__stage">
        <MovieScene playing={d.booted && d.playing && !prefersReducedMotion()} />
        <FloatLayer items={d.floats} />
        <div className="fake__bubbles">
          {DEMO_PEOPLE.slice(0, d.viewers).map((p) => (
            <span key={p.name} className="fake__bubble">
              <Avatar seed={p.seed} size={24} tone="ok" />
            </span>
          ))}
        </div>
        <div className="fake__chat">
          {d.chat.map((c) => (
            <p key={c.id}>
              <b>{c.name}</b> {c.text}
            </p>
          ))}
        </div>
        {d.toast && (
          <div key={d.toast.id} className="fake__toast">
            {d.toast.text}
          </div>
        )}
        {!d.playing && d.booted && <div className="fake__paused">❚❚ PAUSED FOR EVERYONE</div>}
        <div className={cx("fake__boot", d.booted && "is-done")}>
          <span className="fake__boot-logo">★ STARBYTE</span>
          <span className={cx("fake__boot-status", d.phase === "synced" && "is-synced")}>
            <i />
            {BOOT_TEXT[d.phase]}
            {d.phase === "synced" ? ` ${d.syncMs}ms` : "…"}
          </span>
          <span className="fake__boot-bar">
            <i style={{ width: `${((BOOT_ORDER.indexOf(d.phase) + 1) / BOOT_ORDER.length) * 100}%` }} />
          </span>
        </div>
      </div>
      <div className="fake__controls">
        <span className="fake__play">{d.playing ? "❚❚" : "▶"}</span>
        <span className="fake__time tnum">{formatTime(d.time, true)}</span>
        <span className="fake__track">
          <i style={{ width: `${progress * 100}%` }} />
        </span>
        <span className="fake__sync tnum">
          <i /> SYNCED {d.syncMs}ms
        </span>
      </div>
    </div>
  );
}

const DIALOG = [
  "Psst. The movie never leaves your laptop.",
  "Everyone presses play at the exact same moment.",
  "This room is live. Go on — press something.",
];

/** Section 3 — the playable demo. Retro battle-menu controls that drive the hero room. */
export function LiveDemo() {
  const d = useDemo();
  const [line, setLine] = useState(0);
  const [typed, setTyped] = useState(prefersReducedMotion() ? DIALOG[0]! : "");

  useEffect(() => {
    const full = DIALOG[line]!;
    if (prefersReducedMotion()) {
      setTyped(full);
      const t = window.setTimeout(() => setLine((l) => (l + 1) % DIALOG.length), 6000);
      return () => clearTimeout(t);
    }
    let i = 0;
    setTyped("");
    const typer = window.setInterval(() => {
      i++;
      setTyped(full.slice(0, i));
      if (i >= full.length) clearInterval(typer);
    }, 32);
    const next = window.setTimeout(() => setLine((l) => (l + 1) % DIALOG.length), 5200);
    return () => {
      clearInterval(typer);
      clearTimeout(next);
    };
  }, [line]);

  return (
    <section className="demo" id="demo" aria-labelledby="demo-title">
      <div className="container demo__grid">
        <div className="frame demo__dialog reveal">
          <span className="demo__portrait">
            <Mascot pose="idle" scale={3} bob={false} />
          </span>
          <div className="demo__speech">
            <p className="demo__speaker">BYTE</p>
            <p className="demo__line">
              <span aria-hidden="true">▸ </span>
              {typed}
              <span className="demo__caret" aria-hidden="true" />
            </p>
            <p className="visually-hidden" aria-live="polite">
              {DIALOG[line]}
            </p>
          </div>
        </div>

        <div className="frame demo__menu reveal" style={{ ["--d" as string]: 1 }}>
          <div className="demo__menu-head">
            <h2 id="demo-title" className="demo__title">
              <span className="pixel">Room 001</span> · try it live
            </h2>
            <span className="demo__lv tnum">
              LV 1 <span className="demo__hp" aria-hidden="true"><i style={{ width: `${100 - d.syncMs}%` }} /></span>{" "}
              {d.syncMs}ms
            </span>
          </div>
          <div className="demo__actions" role="group" aria-label="Control the demo room">
            <button type="button" className="act act--play" onClick={demo.toggle} aria-pressed={!d.playing}>
              {d.playing ? <Pause size={16} strokeWidth={2.5} /> : <Play size={16} strokeWidth={2.5} />}
              {d.playing ? "Pause" : "Play"}
            </button>
            <button type="button" className="act act--react" onClick={() => demo.react()}>
              <SparklesIcon size={16} strokeWidth={2.5} />
              React
            </button>
            <button type="button" className="act act--moment" onClick={demo.moment}>
              <Star size={16} strokeWidth={2.5} />
              Moment
            </button>
            <button type="button" className="act act--chat" onClick={demo.chat}>
              <MessageSquare size={16} strokeWidth={2.5} />
              Chat
            </button>
          </div>
        </div>

        <div className="frame demo__status reveal" style={{ ["--d" as string]: 2 }}>
          <p className="demo__status-title">Room status</p>
          <dl className="demo__stats">
            <div>
              <dt>Viewers</dt>
              <dd className="tnum">{d.viewers || "—"}</dd>
            </div>
            <div>
              <dt>Sync</dt>
              <dd className="tnum is-ok">{d.booted ? `${d.syncMs}ms` : "…"}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>Local</dd>
            </div>
            <div>
              <dt>Media</dt>
              <dd className="is-ok">{d.booted ? "Matched" : "Checking"}</dd>
            </div>
            <div>
              <dt>Playback</dt>
              <dd>{d.playing ? "Playing" : "Paused"}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
