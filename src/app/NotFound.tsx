import { useEffect } from "react";
import { Mascot } from "../art/Mascot";
import { PixelLink } from "../ui/PixelButton";
import { AppShell } from "./AppShell";

export default function NotFound() {
  useEffect(() => {
    document.title = "Lost in the dark — STARBYTE";
  }, []);
  return (
    <AppShell back={null}>
      <div className="lost">
        <Mascot pose="back" scale={6} />
        <p className="eyebrow">404 · Wrong theatre</p>
        <h1 className="page-title pixel">This screen is dark.</h1>
        <p className="page-sub">The page you're looking for isn't showing tonight.</p>
        <PixelLink to="/" size="lg">
          Back to the lobby
        </PixelLink>
      </div>
    </AppShell>
  );
}
