import { WifiOff, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { normalizeRoomId } from "../../shared/ids";
import { Mascot } from "../art/Mascot";
import { AppShell } from "../app/AppShell";
import { cx } from "../lib/cx";
import { navigate } from "../lib/router";
import { PixelButton, PixelLink } from "../ui/PixelButton";
import { SessionContext, useRoom, useSession } from "./context";
import { Entering } from "./Entering";
import { Gate } from "./Gate";
import { Lobby } from "./Lobby";
import { RoomScreen } from "./RoomScreen";
import { RoomSession } from "./session";
import "./room.css";

export default function RoomPage({ roomId: raw }: { roomId: string }) {
  const roomId = normalizeRoomId(raw);
  const [session, setSession] = useState<RoomSession | null>(null);

  useEffect(() => {
    if (!roomId) return;
    if (raw !== roomId) {
      navigate(`/r/${roomId}`, { replace: true });
      return;
    }
    const s = new RoomSession(roomId);
    setSession(s);
    void s.start();
    // Dev-only handle for end-to-end tests; stripped from production builds.
    if (import.meta.env.DEV) (window as unknown as { __starbyte?: RoomSession }).__starbyte = s;
    return () => s.dispose();
  }, [roomId, raw]);

  if (!roomId) {
    return (
      <ErrorScreen title="That room code doesn't look right" message="Room codes have 8 characters, like 4H7K-9XQP." />
    );
  }
  if (!session) return <div className="page-loading" aria-busy="true" />;
  return (
    <SessionContext.Provider value={session}>
      <ConnTrouble />
      <RoomRouter />
      <Toasts />
    </SessionContext.Provider>
  );
}

/**
 * A connection that has never worked, explained — in every phase, not just inside the room.
 * "Reconnecting…" forever is the single most useless thing this app could say.
 */
function ConnTrouble() {
  const session = useSession();
  const trouble = useRoom((s) => s.conn.trouble);
  if (!trouble) return null;
  return (
    <div className="conntrouble" role="alert">
      <div className="conntrouble__inner">
        <WifiOff size={18} aria-hidden="true" />
        <p>
          <strong>Can't reach the room.</strong> {trouble}
        </p>
        <PixelButton size="sm" variant="ghost" onClick={() => session.reconnectNow()}>
          Try again
        </PixelButton>
      </div>
    </div>
  );
}

function RoomRouter() {
  const phase = useRoom((s) => s.phase);
  const name = useRoom((s) => s.room?.name ?? s.info?.name);

  useEffect(() => {
    document.title = name ? `${name} — STARBYTE` : "STARBYTE — Watch Party";
  }, [name]);

  switch (phase) {
    case "loading":
      return (
        <AppShell>
          <div className="room-loading" aria-busy="true">
            <Mascot pose="idle" scale={5} />
            <p className="room-loading__text pixel">Finding your room…</p>
          </div>
        </AppShell>
      );
    case "gate":
      return <Gate />;
    case "lobby":
      return <Lobby />;
    case "entering":
      return <Entering />;
    case "room":
      return <RoomScreen />;
    case "error":
      return <SessionError />;
  }
}

function SessionError() {
  const session = useSession();
  const error = useRoom((s) => s.error);
  if (!error) return null;
  return (
    <ErrorScreen title={error.title} message={error.message}>
      {error.kind === "replaced" && (
        <PixelButton size="lg" onClick={() => session.reclaim()}>
          Watch in this tab instead
        </PixelButton>
      )}
      {error.kind === "version" && (
        <PixelButton size="lg" onClick={() => window.location.reload()}>
          Refresh
        </PixelButton>
      )}
      {error.kind === "network" && (
        <PixelButton size="lg" onClick={() => window.location.reload()}>
          Try again
        </PixelButton>
      )}
    </ErrorScreen>
  );
}

function ErrorScreen({ title, message, children }: { title: string; message: string; children?: ReactNode }) {
  return (
    <AppShell>
      <div className="room-error" role="alert">
        <Mascot pose="back" scale={6} />
        <h1 className="page-title pixel">{title}</h1>
        <p className="page-sub">{message}</p>
        <div className="room-error__actions">
          {children}
          <PixelLink to="/" size="lg" variant="ghost">
            Home
          </PixelLink>
          <PixelLink to="/create" size="lg" variant="ghost">
            New room
          </PixelLink>
        </div>
      </div>
    </AppShell>
  );
}

function Toasts() {
  const session = useSession();
  const toasts = useRoom((s) => s.toasts);
  const inRoom = useRoom((s) => s.phase === "room");
  return (
    // In the room, toasts sit at the top so they never cover the playback controls.
    <div className={cx("toasts", inRoom && "toasts--room")} aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div key={t.id} className={cx("toast", t.tone !== "info" && `toast--${t.tone}`)} role={t.tone === "danger" ? "alert" : "status"}>
          <span className="toast__body">{t.text}</span>
          <button type="button" className="ibtn ibtn--sm" onClick={() => session.dismissToast(t.id)} aria-label="Dismiss">
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}
