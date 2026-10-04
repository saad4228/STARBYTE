import { ArrowRight, AtSign, Code2, Globe, Link2, MessageCircle, User } from "lucide-react";
import { useEffect, type ComponentType } from "react";
import { Mascot } from "../art/Mascot";
import { Pixel } from "../art/Pixel";
import { icons, sparkleSmall } from "../art/sprites";
import { PixelLink } from "../ui/PixelButton";
import { AppShell } from "./AppShell";
import { formatCount, useVisits } from "./visits";
import "./about.css";

/* ─────────────────────────────────────────────────────────────────────────────
 * EDIT ME — everything personal on this page lives in this one object.
 * Add or remove links freely; empty strings are skipped.
 * ──────────────────────────────────────────────────────────────────────────── */
const PROFILE = {
  name: "Mohammad Saad",
  tagline: "Developer & designer",
  /** One short line under the name. */
  blurb: "I build things for the web — and occasionally whole little worlds to put them in.",
  /** The dialogue box. One string per line. */
  intro: [
    "Hi — I'm Saad.",
    "STARBYTE started as a simple question: why is watching something with friends still so awkward? So I built the thing I wanted — a room where the movie stays on your own machine and only the moment is shared.",
    "Thanks for stopping by. Go start a room with someone.",
  ],
  /** Shown as the character sheet. Keep the labels short. */
  stats: [
    { label: "Role", value: "Design + engineering" },
    { label: "Focus", value: "Web apps, real-time, interfaces" },
    { label: "Favourite part", value: "Making software feel like a place" },
  ],
  /** Add your own. `icon` is one of the keys in LINK_ICONS below. */
  links: [
    { icon: "github", label: "GitHub", href: import.meta.env.VITE_GITHUB_URL ?? "" },
    { icon: "mail", label: "Email", href: import.meta.env.VITE_CONTACT_EMAIL ? `mailto:${import.meta.env.VITE_CONTACT_EMAIL}` : "" },
    { icon: "linkedin", label: "LinkedIn", href: "" },
    { icon: "twitter", label: "X / Twitter", href: "" },
    { icon: "site", label: "Website", href: "" },
  ],
} as const;

/** Neutral glyphs — lucide dropped brand marks, and each link carries its own text label. */
const LINK_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  github: Code2,
  mail: AtSign,
  linkedin: User,
  twitter: MessageCircle,
  site: Globe,
};

/** Facts about this build, so the page says something real even before the profile is filled in. */
const BUILD = [
  {
    icon: icons.play,
    title: "A sync engine, not a stream",
    body: "The server shares playback state and time — never video. Viewers stay within a few frames of each other with gentle speed correction, and jump back if they fall far behind.",
  },
  {
    icon: icons.lock,
    title: "Local-first by design",
    body: "Your movie is read straight off your disk by the browser. Files are matched by fingerprint and duration, so the room knows everyone has the same cut without anything being uploaded.",
  },
  {
    icon: icons.spark,
    title: "A world, not a landing page",
    body: "Every pixel sprite here is drawn in code — the mascot, the skyline, the cinema, the crowd — from a small engine that turns character maps into SVG.",
  },
];

const STACK = ["React", "TypeScript", "Cloudflare Workers", "Durable Objects", "WebSockets", "Vite"];

export default function About() {
  const visits = useVisits();
  useEffect(() => {
    document.title = `${PROFILE.name} — STARBYTE`;
  }, []);

  const links = PROFILE.links.filter((l) => l.href);

  return (
    <AppShell>
      <article className="about">
        <p className="chapter about__chapter">
          <span className="chapter__num">00</span>
          <span className="chapter__rule" aria-hidden="true" />
          <span className="chapter__name">The developer</span>
        </p>

        <header className="about__head">
          <div className="portrait">
            <picture>
              <source srcSet="/saad.webp" type="image/webp" />
              <img src="/saad.jpg" width={447} height={447} alt={`${PROFILE.name}`} className="portrait__img" />
            </picture>
            <span className="portrait__scan" aria-hidden="true" />
          </div>
          <div className="about__id">
            <h1 className="about__name pixel">{PROFILE.name}</h1>
            <p className="about__tagline">{PROFILE.tagline}</p>
            <p className="about__blurb">{PROFILE.blurb}</p>
            <ul className="stack" aria-label="Built with">
              {STACK.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </header>

        <section className="frame speech" aria-label="Introduction">
          <span className="speech__who">
            <Mascot pose="idle" scale={3} bob={false} />
          </span>
          <div className="speech__body">
            {PROFILE.intro.map((line, i) => (
              <p key={i}>
                {i === 0 && <span aria-hidden="true">▸ </span>}
                {line}
              </p>
            ))}
          </div>
        </section>

        <div className="about__grid">
          <section className="frame sheet-card" aria-labelledby="sheet-title">
            <h2 id="sheet-title" className="about__h2 pixel">
              Character sheet
            </h2>
            <dl className="sheet-list">
              {PROFILE.stats.map((s) => (
                <div key={s.label}>
                  <dt>{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
              {visits && (
                <>
                  <div>
                    <dt>Visitors today</dt>
                    <dd className="tnum sheet-list__num">{formatCount(visits.today)}</dd>
                  </div>
                  <div>
                    <dt>Visitors all time</dt>
                    <dd className="tnum sheet-list__num">{formatCount(visits.total)}</dd>
                  </div>
                </>
              )}
            </dl>
            {links.length > 0 && (
              <nav className="links" aria-label="Find me">
                {links.map((l) => {
                  const Icon = LINK_ICONS[l.icon] ?? Link2;
                  const external = !l.href.startsWith("mailto:");
                  return (
                    <a
                      key={l.label}
                      href={l.href}
                      className="links__item"
                      {...(external ? { target: "_blank", rel: "noreferrer me" } : {})}
                    >
                      <Icon size={16} />
                      {l.label}
                    </a>
                  );
                })}
              </nav>
            )}
          </section>

          <section className="about__build" aria-labelledby="build-title">
            <h2 id="build-title" className="about__h2 pixel">
              About this build
            </h2>
            <ul className="build-list">
              {BUILD.map((b) => (
                <li key={b.title} className="frame build-item">
                  <Pixel sprite={b.icon} scale={3} />
                  <div>
                    <h3>{b.title}</h3>
                    <p>{b.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="about__cta frame">
          <Pixel sprite={sparkleSmall} scale={3} />
          <p>
            <strong>Enough about me.</strong> Grab a film, send a link to someone.
          </p>
          <PixelLink to="/create" iconEnd={<ArrowRight size={18} strokeWidth={2.5} />}>
            Enter cinema
          </PixelLink>
        </section>

      </article>
    </AppShell>
  );
}
