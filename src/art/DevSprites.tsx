import { Avatar } from "./Avatar";
import { Mascot } from "./Mascot";
import { MovieScene } from "./MovieScene";
import { Pixel } from "./Pixel";
import { cinema, crowd, moon, skyline, stadium } from "./scenes";
import { heart, icons, projector, sparkle, viewerLook, viewerSprite } from "./sprites";

/** Dev-only sprite sheet at /dev/sprites, for checking pixel art at a glance. */
export default function DevSprites() {
  return (
    <main style={{ padding: 24, display: "grid", gap: 32, background: "#07060c" }}>
      <section style={{ display: "flex", gap: 24, alignItems: "end", flexWrap: "wrap" }}>
        {(["idle", "remote", "laptop", "scarf", "popcorn", "back"] as const).map((pose) => (
          <Mascot key={pose} pose={pose} scale={8} />
        ))}
      </section>
      <section style={{ display: "flex", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
        {Array.from({ length: 10 }, (_, i) => (
          <Pixel key={i} sprite={viewerSprite(viewerLook(i + 1))} scale={6} />
        ))}
      </section>
      <section style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        {Array.from({ length: 12 }, (_, i) => (
          <Avatar key={i} seed={i * 7919 + 13} size={56} tone={(["ok", "warn", "idle", "none"] as const)[i % 4]} />
        ))}
      </section>
      <section style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        {Object.entries(icons).map(([name, s]) => (
          <Pixel key={name} sprite={s} scale={5} />
        ))}
        <Pixel sprite={heart} scale={6} />
        <Pixel sprite={sparkle} scale={6} />
      </section>
      <section style={{ display: "flex", gap: 24, alignItems: "end", flexWrap: "wrap" }}>
        <Pixel sprite={projector} scale={6} />
        <Pixel sprite={moon()} scale={4} />
        <Pixel sprite={cinema()} scale={3} />
      </section>
      <section style={{ display: "grid", gap: 8 }}>
        <Pixel sprite={skyline()} scale={3} />
        <Pixel sprite={stadium()} scale={3} />
        <Pixel sprite={crowd()} scale={3} />
      </section>
      <section style={{ display: "flex", gap: 16 }}>
        <div style={{ width: 480, aspectRatio: "16/9" }}>
          <MovieScene />
        </div>
        <div style={{ width: 480, aspectRatio: "16/9" }}>
          <MovieScene variant="pitch" />
        </div>
      </section>
    </main>
  );
}
