import { useRef } from "react";
import { ChapterRail } from "./ChapterRail";
import { FinalCta, Footer } from "./FinalCta";
import { Hero, LiveDemo } from "./Hero";
import { LightTrail } from "./LightTrail";
import { LiveSection } from "./LiveSection";
import { MomentsSection } from "./MomentsSection";
import { Navbar } from "./Navbar";
import { useOffscreenAnimationPause, useReveal } from "./parts";
import { PrivacySection } from "./PrivacySection";
import { RoomShowcase } from "./RoomShowcase";
import { SocialSection } from "./SocialSection";
import { Sources } from "./Sources";
import { SyncSection } from "./SyncSection";
import "./landing.css";
import "./sections.css";

/**
 * The landing page: a modern product living inside a pixel-art night-cinema world.
 * One continuous sky and one light trail run through every chapter.
 */
export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  useOffscreenAnimationPause(root);

  return (
    <div className="landing" ref={root}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="sky" aria-hidden="true" />
      <LightTrail rootRef={root} />
      <Navbar />
      <main id="main">
        <Hero />
        <LiveDemo />
        <Sources />
        <RoomShowcase />
        <SyncSection />
        <SocialSection />
        <MomentsSection />
        <LiveSection />
        <PrivacySection />
        <FinalCta />
      </main>
      <Footer />
      <ChapterRail />
    </div>
  );
}
