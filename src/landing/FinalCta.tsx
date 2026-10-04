import { ArrowRight } from "lucide-react";
import { Mascot } from "../art/Mascot";
import { Pixel } from "../art/Pixel";
import { cinema, moon } from "../art/scenes";
import { viewerLook, viewerSprite } from "../art/sprites";
import { Link } from "../lib/router";
import { Logo } from "../ui/Logo";
import { PixelLink } from "../ui/PixelButton";
import { VisitCounter } from "../ui/VisitCounter";
import { Sparkles, TrailAnchor } from "./parts";

const WALKERS = [5, 13].map((seed) => viewerSprite(viewerLook(seed)));
/** In the footer, "GitHub" means this project's source — the About page links the person. */
const GITHUB_URL = (import.meta.env.VITE_GITHUB_URL as string | undefined) || "https://github.com/saad4228/STARBYTE";

/** The last scene: the night cinema, doors open, everyone walking in. */
export function FinalCta() {
  return (
    <section className="final" aria-labelledby="final-title">
      <div className="final__sky" aria-hidden="true">
        <Pixel sprite={moon()} scale={0} className="final__moon" />
        <Sparkles
          points={[
            { x: "12%", y: "18%", big: true },
            { x: "26%", y: "46%" },
            { x: "71%", y: "12%" },
            { x: "86%", y: "38%", big: true, scale: 2 },
            { x: "58%", y: "30%" },
          ]}
        />
      </div>

      <div className="container final__copy">
        <h2 id="final-title" className="final__title pixel reveal">
          Stop watching <em>alone.</em>
        </h2>
        <p className="final__sub reveal" style={{ ["--d" as string]: 1 }}>
          Bring your screen. Bring your people.
        </p>
        <div className="reveal" style={{ ["--d" as string]: 2 }}>
          <PixelLink to="/create" size="lg" iconEnd={<ArrowRight size={18} strokeWidth={2.5} />}>
            Enter cinema
          </PixelLink>
        </div>
      </div>

      <div className="final__scene" aria-hidden="true">
        <div className="final__building">
          <TrailAnchor x={0.5} y="54%" />
          <Pixel sprite={cinema()} scale={0} className="final__cinema" />
          <span className="final__marquee">
            <span className="pixel">Starbyte</span>
            <small>Now showing · your pick</small>
          </span>
          <span className="final__spill" />
        </div>
        <div className="final__walkers">
          <Pixel sprite={WALKERS[0]!} scale={4} className="final__walker" />
          <Mascot pose="back" scale={4} className="final__byte" />
          <Pixel sprite={WALKERS[1]!} scale={4} className="final__walker" />
        </div>
        <div className="final__ground" />
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div className="footer__brand">
          <Logo />
          <p>A multiplayer media room. Your screen, their reactions.</p>
          <p className="footer__indie">Built as an independent project.</p>
        </div>
        <nav className="footer__cols" aria-label="Footer">
          <div>
            <h3>Product</h3>
            <a href="/#how-it-works">How it works</a>
            <a href="/#features">Features</a>
            <Link to="/create">Create a room</Link>
            <Link to="/join">Join a room</Link>
          </div>
          <div>
            <h3>Developers</h3>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
          </div>
          <div>
            <h3>Policies</h3>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </div>
          <div>
            <h3>Maker</h3>
            <Link to="/about">About me</Link>
          </div>
        </nav>
      </div>
      <div className="container footer__base">
        <span>© {new Date().getFullYear()} STARBYTE</span>
        <Link to="/about" className="byline">
          <picture>
            <source srcSet="/saad.webp" type="image/webp" />
            <img src="/saad.jpg" width={28} height={28} alt="" className="byline__face" loading="lazy" decoding="async" />
          </picture>
          <span>
            Made by <strong>Mohammad Saad</strong>
          </span>
        </Link>
        <VisitCounter />
      </div>
    </footer>
  );
}
