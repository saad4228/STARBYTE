import { Check, X } from "lucide-react";
import { useMemo, useRef } from "react";
import { Avatar } from "../art/Avatar";
import { Pixel } from "../art/Pixel";
import { icons } from "../art/sprites";

import { logoStar } from "../ui/Logo";
import { DEMO_PEOPLE } from "./demo";
import { SectionHead, TrailAnchor } from "./parts";
import { Wires, type WireLink } from "./Wires";

const SEES = [
  "Your display name",
  "Play, pause, seek and speed changes",
  "Chat messages, reactions and moments",
  "Your file's name, size, duration and a sampled fingerprint — only to check everyone has the same movie",
];

const NEVER = [
  "The movie itself — not a single frame",
  "Your other files and folders",
  "Your screen",
  "An account, email or password — there isn't one",
];

/** 07 / LOCAL-FIRST — an honest account of what travels and what never does. */
export function PrivacySection() {
  const vault = useRef<HTMLDivElement>(null);
  const computer = useRef<HTMLDivElement>(null);
  const cloud = useRef<HTMLDivElement>(null);
  const source = useRef<HTMLDivElement>(null);
  const core = useRef<HTMLDivElement>(null);
  const people = useRef<HTMLDivElement>(null);
  const links = useMemo<WireLink[]>(
    () => [
      { from: computer, to: core },
      { from: cloud, to: core },
      { from: source, to: core },
      { from: core, to: people },
    ],
    [],
  );

  return (
    <section className="section privacy" id="privacy" aria-labelledby="privacy-title">
      <TrailAnchor x={0.94} y="38%" />
      <div className="container">
        <SectionHead
          num="07"
          name="Local-first"
          id="privacy-title"
          title={
            <>
              We don't need <em>your movie.</em>
            </>
          }
          sub="We need the moment."
        />

        <div className="vault" ref={vault}>
          <Wires container={vault} links={links} />
          <div className="vault__left">
            <div className="vault__box vault__box--main reveal reveal--fade" ref={computer}>
              <span className="vault__label">Your computer</span>
              <span className="vault__file">
                <Pixel sprite={icons.local} scale={2} />
                movie.mp4
                <Pixel sprite={icons.lock} scale={2} />
              </span>
              <span className="vault__note">Stays right here</span>
            </div>
            <div className="vault__box reveal reveal--fade" ref={cloud} style={{ ["--d" as string]: 1 }}>
              <span className="vault__label">Your Drive</span>
              <span className="vault__note">Streams to you</span>
            </div>
            <div className="vault__box reveal reveal--fade" ref={source} style={{ ["--d" as string]: 2 }}>
              <span className="vault__label">Your link</span>
              <span className="vault__note">Straight from the host</span>
            </div>
          </div>
          <div className="vault__core reveal reveal--fade" ref={core} style={{ ["--d" as string]: 2 }}>
            <Pixel sprite={logoStar} scale={5} />
            <span className="pixel">Starbyte</span>
            <span className="vault__core-sub">play · pause · seek · chat</span>
          </div>
          <div className="vault__people reveal reveal--fade" ref={people} style={{ ["--d" as string]: 3 }}>
            <span className="vault__label">Your people</span>
            <span className="vault__avatars">
              {DEMO_PEOPLE.map((p) => (
                <Avatar key={p.name} seed={p.seed} size={34} tone="ok" />
              ))}
            </span>
          </div>
        </div>

        <div className="inspector">
          <div className="frame inspector__col reveal">
            <h3 className="inspector__title is-ok">What the room sees</h3>
            <ul>
              {SEES.map((s) => (
                <li key={s}>
                  <Check size={16} strokeWidth={2.5} aria-hidden="true" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="frame inspector__col reveal" style={{ ["--d" as string]: 1 }}>
            <h3 className="inspector__title is-danger">What it never sees in Local Mode</h3>
            <ul>
              {NEVER.map((s) => (
                <li key={s}>
                  <X size={16} strokeWidth={2.5} aria-hidden="true" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="privacy__foot reveal">
          Rooms, their chat and their moments are deleted after 24 hours with nobody inside.
        </p>
      </div>
    </section>
  );
}
