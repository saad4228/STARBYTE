import { useMemo, useRef } from "react";
import { Avatar } from "../art/Avatar";
import { Mascot } from "../art/Mascot";
import { Pixel } from "../art/Pixel";
import { icons } from "../art/sprites";
import { cx } from "../lib/cx";
import { Badge, Chip } from "../ui/Badge";
import { logoStar } from "../ui/Logo";
import { DEMO_PEOPLE } from "./demo";
import { SectionHead, TrailAnchor } from "./parts";
import { Wires, type WireLink } from "./Wires";

const SOURCES = [
  {
    icon: icons.local,
    kicker: "Local",
    title: "Local playback",
    body: "Your file stays on your device. No movie upload required.",
    live: true,
  },
  {
    icon: icons.cloud,
    kicker: "Drive",
    title: "Google Drive",
    body: "Paste a share link. Everyone plays that one file — nobody hunts for their own copy.",
    live: true,
  },
  {
    icon: icons.stream,
    kicker: "Link",
    title: "Direct link",
    body: "Any https video URL the browser can open, checked before it reaches the room.",
    live: true,
  },
];

/** 01 / THE SCREEN — where the media comes from, and why it never has to move. */
export function Sources() {
  const flow = useRef<HTMLDivElement>(null);
  const cards = [useRef<HTMLElement>(null), useRef<HTMLElement>(null), useRef<HTMLElement>(null)];
  const core = useRef<HTMLDivElement>(null);
  const people = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const links = useMemo<WireLink[]>(
    () => [...cards.map((from) => ({ from, to: core })), ...people.map((to) => ({ from: core, to }))],
    [],
  );

  return (
    <section className="section sources" id="how-it-works" aria-labelledby="sources-title">
      <TrailAnchor x={0.05} y="58%" />
      <div className="container">
        <SectionHead
          num="01"
          name="The screen"
          id="sources-title"
          title={
            <>
              Your movie doesn't have to <em>live here.</em>
            </>
          }
          sub="Bring a supported source. STARBYTE brings everyone into the same moment. Your device. Your cloud. Your source. One shared room."
        />

        <div className="flow" ref={flow}>
          <Wires container={flow} links={links} />
          <div className="flow__sources">
            {SOURCES.map((s, i) => (
              <article
                key={s.kicker}
                ref={cards[i]}
                className={cx("frame source reveal reveal--fade", s.live && "source--live")}
                style={{ ["--d" as string]: i }}
              >
                <div className="source__head">
                  <Pixel sprite={s.icon} scale={3} />
                  <span className="source__kicker">{s.kicker}</span>
                  <Chip tone={s.live ? "live" : "soon"}>{s.live ? "Available" : "Coming soon"}</Chip>
                </div>
                <h3 className="source__title">{s.title}</h3>
                <p className="source__body">{s.body}</p>
              </article>
            ))}
          </div>

          <div className="flow__core reveal reveal--fade" ref={core} style={{ ["--d" as string]: 2 }}>
            <span className="core__halo" aria-hidden="true" />
            <Pixel sprite={logoStar} scale={7} className="core__star" />
            <span className="core__name pixel">Starbyte</span>
            <span className="core__label">Sync engine</span>
            <ul className="core__events" aria-label="What travels between viewers">
              <li>Play</li>
              <li>Pause</li>
              <li>Seek</li>
              <li>Chat</li>
            </ul>
          </div>

          <div className="flow__people">
            {DEMO_PEOPLE.slice(0, 3).map((p, i) => (
              <div
                key={p.name}
                ref={people[i]}
                className="person reveal reveal--fade"
                style={{ ["--d" as string]: 3 + i }}
              >
                <Avatar seed={p.seed} size={40} tone="ok" />
                <span className="person__name">{p.name}</span>
                <Badge tone="ok">Synced</Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="sources__note reveal">
          <Mascot pose="laptop" scale={4} className="sources__mascot" />
          <p>
            <strong>No uploads. No screen-share blur.</strong> Every friend plays their own copy at full quality.
            STARBYTE only carries tiny sync signals — play, pause, seek — never the movie.
          </p>
        </div>
      </div>
    </section>
  );
}
