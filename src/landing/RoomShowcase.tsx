import { Maximize, MessageSquare, PanelRightClose, PanelRightOpen, Pause, Settings, Users, Volume2 } from "lucide-react";
import { useRef, useState } from "react";
import { REACTIONS } from "../../shared/constants";
import { Avatar } from "../art/Avatar";
import { Mascot } from "../art/Mascot";
import { MovieScene } from "../art/MovieScene";
import { cx } from "../lib/cx";
import { prefersReducedMotion } from "../lib/router";
import { logoStar } from "../ui/Logo";
import { Pixel } from "../art/Pixel";
import { DEMO_PEOPLE, type FloatItem } from "./demo";
import { FloatLayer, SectionHead, TrailAnchor, useInView, useTicker } from "./parts";

const CHAT = [
  { name: "SAAD", seed: 1207, text: "this scene 💀" },
  { name: "ALI", seed: 5521, text: "broooo 😭" },
  { system: "🔥 Ali marked a moment · 01:24:38" },
  { name: "ZAIN", seed: 3141, text: "who's on snacks next time" },
  { name: "AHMED", seed: 88, text: "the music in this part 🔥" },
  { system: "Zain paused · 01:25:02" },
  { name: "SAAD", seed: 1207, text: "ok ok resume" },
] as const;

const MOMENT_PINS = [
  { at: 24, emoji: "😂" },
  { at: 50, emoji: "🔥" },
  { at: 60, emoji: "😱" },
];

const NOTES = [
  { n: "1", title: "Movie first", body: "The film fills the room. Controls fade until you need them." },
  { n: "2", title: "Friends around it", body: "Presence bubbles float at the edge — never a Zoom grid." },
  { n: "3", title: "Chat that steps aside", body: "Cinema mode tucks the panel away; messages drift over the picture." },
  { n: "4", title: "Sync you can see", body: "One glance at the HUD tells you everyone is on the same frame." },
];

/** 02 / THE ROOM — the real product UI, floating in the world. */
export function RoomShowcase() {
  const [stageRef, inView] = useInView<HTMLDivElement>(0.15);
  const [cinema, setCinema] = useState(false);
  const [shown, setShown] = useState(3);
  const [floats, setFloats] = useState<FloatItem[]>([]);
  const nextId = useRef(1);
  const reduced = prefersReducedMotion();

  const burst = (emoji: string) => {
    const item = { id: nextId.current++, emoji, x: 10 + Math.random() * 60 };
    setFloats((f) => [...f.slice(-12), item]);
    window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== item.id)), 2900);
  };

  useTicker(inView && !reduced, 2800, () => setShown((s) => (s >= CHAT.length ? 3 : s + 1)));
  useTicker(inView && !reduced, 3400, () => burst(REACTIONS[Math.floor(Math.random() * REACTIONS.length)]!));

  const visible = CHAT.slice(Math.max(0, shown - 5), shown);

  return (
    <section className="section showcase" id="features" aria-labelledby="room-title">
      <TrailAnchor x={0.96} y="42%" />
      <div className="container">
        <SectionHead
          align="center"
          num="02"
          name="The room"
          id="room-title"
          title={
            <>
              Then the screen <em>becomes the room.</em>
            </>
          }
          sub="Movie first. Friends around it. Everything else politely gets out of the way."
        />

        <figure className="showcase__stage reveal" ref={stageRef}>
          <Mascot pose="popcorn" scale={4} className="showcase__mascot" />
          <div className={cx("mock", cinema && "mock--cinema")}>
            <div className="mock__chrome" aria-hidden="true">
              <span className="mock__dots">
                <i />
                <i />
                <i />
              </span>
              <span className="mock__url">starbyte.app/r/4H7K-9XQP</span>
            </div>

            <div className="mock__top" aria-hidden="true">
              <span className="mock__brand">
                <Pixel sprite={logoStar} scale={2} /> STARBYTE
              </span>
              <span className="mock__room">
                ROOM 4H7K-9XQP <b>Friday Night</b>
              </span>
              <span className="mock__top-end">
                <span className="mock__online">
                  <Users size={14} /> 4
                </span>
                <Settings size={15} />
              </span>
            </div>

            <div className="mock__body">
              <div className="mock__stage">
                <div className="mock__video">
                  <MovieScene playing={inView && !reduced} />
                  <FloatLayer items={floats} />
                  <span className="marker marker--1" aria-hidden="true">
                    1
                  </span>
                  <div className="mock__bubbles" aria-hidden="true">
                    {DEMO_PEOPLE.map((p, i) => (
                      <span key={p.name} className={cx("mock__bubble", i === 1 && "is-speaking")}>
                        <Avatar seed={p.seed} size={34} tone={i === 3 ? "warn" : "ok"} glow={i === 1} />
                        <span className="mock__bubble-name">{p.name}</span>
                      </span>
                    ))}
                    <span className="marker marker--2">2</span>
                  </div>
                  {cinema && (
                    <div className="mock__overlay-chat" aria-hidden="true">
                      {visible
                        .filter((m) => !("system" in m))
                        .slice(-2)
                        .map((m, i) => (
                          <p key={`${shown}-${i}`}>
                            <b>{"name" in m ? m.name : ""}</b> {"text" in m ? m.text : ""}
                          </p>
                        ))}
                    </div>
                  )}
                </div>

                <div className="mock__controls">
                  <div className="mock__seek" aria-hidden="true">
                    <span className="mock__seek-fill" />
                    {MOMENT_PINS.map((m) => (
                      <span key={m.at} className="mock__pin" style={{ left: `${m.at}%` }}>
                        {m.emoji}
                      </span>
                    ))}
                  </div>
                  <div className="mock__row">
                    <span className="mock__icon" aria-hidden="true">
                      <Pause size={16} />
                    </span>
                    <span className="mock__time tnum" aria-hidden="true">
                      01:24:32 <i>/ 02:49:13</i>
                    </span>
                    <span className="mock__icon mock__icon--dim" aria-hidden="true">
                      <Volume2 size={16} />
                    </span>
                    <div className="mock__reacts" role="group" aria-label="Try a reaction">
                      {REACTIONS.map((e) => (
                        <button key={e} type="button" onClick={() => burst(e)} aria-label={`React with ${e}`}>
                          {e}
                        </button>
                      ))}
                    </div>
                    <span className="mock__sync tnum" aria-hidden="true">
                      <i /> SYNCED 18ms
                      <span className="marker marker--4">4</span>
                    </span>
                    <button
                      type="button"
                      className={cx("mock__toggle", cinema && "is-on")}
                      onClick={() => setCinema((c) => !c)}
                      aria-pressed={cinema}
                      title="Toggle cinema mode"
                    >
                      {cinema ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
                      <span>{cinema ? "Show social" : "Cinema mode"}</span>
                    </button>
                    <span className="mock__icon mock__icon--dim" aria-hidden="true">
                      <Maximize size={15} />
                    </span>
                  </div>
                </div>
              </div>

              <aside className="mock__side" aria-hidden="true">
                <div className="mock__tabs">
                  <span className="is-active">
                    <MessageSquare size={13} /> Chat
                  </span>
                  <span>People 4</span>
                  <span>Moments 3</span>
                  <span className="marker marker--3">3</span>
                </div>
                <div className="mock__people">
                  {DEMO_PEOPLE.map((p, i) => (
                    <span key={p.name} className="mock__person">
                      <i className={i === 3 ? "is-warn" : ""} /> {p.name}
                      {i === 0 && <em>host</em>}
                    </span>
                  ))}
                </div>
                <div className="mock__chat">
                  {visible.map((m, i) =>
                    "system" in m ? (
                      <p key={`${shown}-${i}`} className="mock__sys">
                        {m.system}
                      </p>
                    ) : (
                      <p key={`${shown}-${i}`} className="mock__msg">
                        <Avatar seed={m.seed} size={22} />
                        <span>
                          <b>{m.name}</b>
                          {m.text}
                        </span>
                      </p>
                    ),
                  )}
                </div>
                <div className="mock__input">Say something…</div>
              </aside>
            </div>
          </div>
          <figcaption className="visually-hidden">
            An interactive preview of a STARBYTE room: the movie fills the screen, friends appear as bubbles, chat sits
            in a side panel that cinema mode hides, and a sync indicator shows everyone is on the same frame.
          </figcaption>
        </figure>

        <ol className="notes">
          {NOTES.map((n, i) => (
            <li key={n.n} className="note reveal" style={{ ["--d" as string]: i }}>
              <span className="note__n" aria-hidden="true">
                {n.n}
              </span>
              <h3 className="note__title">{n.title}</h3>
              <p className="note__body">{n.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
