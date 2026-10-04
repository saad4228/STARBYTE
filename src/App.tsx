import { lazy, Suspense, useEffect } from "react";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { loadVisits } from "./app/visits";
import { matchPath, usePath } from "./lib/router";

// Each surface is its own chunk: visitors reading the landing page never download the room engine.
const Landing = lazy(() => import("./landing/Landing"));
const CreateRoom = lazy(() => import("./app/CreateRoom"));
const JoinRoom = lazy(() => import("./app/JoinRoom"));
const RoomPage = lazy(() => import("./room/RoomPage"));
const LegalPage = lazy(() => import("./app/LegalPage"));
const About = lazy(() => import("./app/About"));
const NotFound = lazy(() => import("./app/NotFound"));
const DevSprites = import.meta.env.DEV ? lazy(() => import("./art/DevSprites")) : null;

const TITLES: Record<string, string> = {
  "/create": "Create a room — STARBYTE",
  "/join": "Join a room — STARBYTE",
  "/privacy": "Privacy — STARBYTE",
  "/terms": "Terms — STARBYTE",
};

export function App() {
  const path = usePath();
  const room = matchPath("/r/:id", path);

  // Counts one visit per browser session, whichever page you land on.
  useEffect(() => {
    void loadVisits();
  }, []);

  useEffect(() => {
    if (!room) document.title = TITLES[path] ?? "STARBYTE — Watch Party";
  }, [path, room]);

  let page;
  if (path === "/") page = <Landing />;
  else if (path === "/create") page = <CreateRoom />;
  else if (path === "/join") page = <JoinRoom />;
  else if (path === "/about") page = <About />;
  else if (room?.id) page = <RoomPage key={room.id} roomId={room.id} />;
  else if (path === "/privacy" || path === "/terms") page = <LegalPage kind={path.slice(1) as "privacy" | "terms"} />;
  else if (DevSprites && path === "/dev/sprites") page = <DevSprites />;
  else page = <NotFound />;

  return (
    // Keyed by path so recovering is as simple as navigating away from a broken screen.
    <ErrorBoundary key={room?.id ?? path}>
      <Suspense fallback={<div className="page-loading" aria-busy="true" />}>{page}</Suspense>
    </ErrorBoundary>
  );
}
