import { Keyboard, Link2, Loader2, PanelRightClose, PanelRightOpen, Settings, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { REACTIONS } from "../../shared/constants";
import { formatRoomId } from "../../shared/ids";
import { inviteUrl } from "../app/api";
import { cx } from "../lib/cx";
import { Logo } from "../ui/Logo";
import { useRoom, useSession } from "./context";
import { toggleFullscreen } from "./Controls";
import { HelpDialog, MediaDialog, SettingsDialog } from "./Dialogs";
import { Panel } from "./Panel";
import { ConnPill } from "./parts";
import { Stage } from "./Stage";

/** The watch room. Cinema mode lets the movie take the whole window. */
export function RoomScreen() {
  const cinema = useRoom((s) => s.ui.cinema);
  const reconnecting = useRoom((s) => s.conn.status === "reconnecting");
  const name = useRoom((s) => s.room?.name ?? "Room");
  useShortcuts();

  return (
    <div className={cx("room", cinema && "room--cinema")}>
      <TopBar />
      {reconnecting && <ConnectionBanner />}
      <main id="main" className="room__main">
        <h1 className="visually-hidden">{name} — watch room</h1>
        <Stage />
        <Panel />
      </main>
      <SettingsDialog />
      <MediaDialog />
      <HelpDialog />
    </div>
  );
}

function TopBar() {
  const session = useSession();
  const name = useRoom((s) => s.room?.name ?? "");
  const roomId = useRoom((s) => s.roomId);
  const cinema = useRoom((s) => s.ui.cinema);
  const unread = useRoom((s) => s.ui.unread);
  const [copied, setCopied] = useState(false);

  const invite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl(roomId));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      session.toast("info", `Invite link: ${inviteUrl(roomId)}`);
    }
  };

  return (
    <header className="topbar">
      <Logo compact className="topbar__logo" />
      <div className="topbar__room">
        <span className="topbar__name">{name}</span>
        <span className="topbar__code tnum">Room {formatRoomId(roomId)}</span>
      </div>
      <button type="button" className="topbar__invite" onClick={invite}>
        <Link2 size={15} aria-hidden="true" />
        <span>{copied ? "Link copied" : "Invite"}</span>
      </button>
      <div className="topbar__end">
        <ConnPill />
        <button
          type="button"
          className={cx("ibtn topbar__panel", !cinema && "is-active")}
          aria-pressed={!cinema}
          aria-label={cinema ? "Show chat and people (C)" : "Cinema mode — hide the panel (C)"}
          onClick={() => session.toggleCinema()}
        >
          {cinema ? <PanelRightOpen /> : <PanelRightClose />}
          {cinema && unread > 0 && <span className="dot-count">{unread > 9 ? "9+" : unread}</span>}
        </button>
        <button type="button" className="ibtn hide-sm" onClick={() => session.openDialog("help")} aria-label="Keyboard shortcuts (?)">
          <Keyboard />
        </button>
        <button type="button" className="ibtn" onClick={() => session.openDialog("settings")} aria-label="Settings">
          <Settings />
        </button>
      </div>
    </header>
  );
}

function ConnectionBanner() {
  const session = useSession();
  const attempt = useRoom((s) => s.conn.attempt);
  const trouble = useRoom((s) => s.conn.trouble);

  // A link that has never worked is not "unstable" — saying so sends people looking for a
  // flaky network when the real cause is sitting in the reply from the server.
  if (trouble) {
    return (
      <div className="connbanner connbanner--stuck" role="alert">
        <WifiOff size={16} aria-hidden="true" />
        <span>
          <strong>Can't reach the room.</strong> {trouble}
        </span>
        <button type="button" className="link-btn" onClick={() => session.reconnectNow()}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="connbanner" role="status">
      <Loader2 size={16} className="spin" aria-hidden="true" />
      <span>
        <strong>Connection unstable.</strong> Playback is still running — reconnecting
        {attempt > 1 ? ` (attempt ${attempt})` : ""}…
      </span>
      <button type="button" className="link-btn" onClick={() => session.reconnectNow()}>
        Retry now
      </button>
    </div>
  );
}

function useShortcuts() {
  const session = useSession();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector("dialog[open]")) return;
      // Let focused controls handle their own keys.
      if ((e.key === " " || e.key === "Enter") && target.closest("button, a, [role='tab']")) return;
      if (e.key.startsWith("Arrow") && target.closest("[role='slider'], [role='radiogroup']")) return;

      switch (e.key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          session.togglePlay();
          return;
        case "ArrowLeft":
        case "j":
        case "J":
          e.preventDefault();
          session.seekBy(-10);
          return;
        case "ArrowRight":
        case "l":
        case "L":
          e.preventDefault();
          session.seekBy(10);
          return;
        case "m":
        case "M":
          session.toggleMute();
          return;
        case "f":
        case "F":
          toggleFullscreen(document.querySelector<HTMLElement>(".stage"));
          return;
        case "c":
        case "C":
          session.toggleCinema();
          return;
        case "s":
        case "S":
          window.dispatchEvent(new Event("starbyte:mark"));
          return;
        case "/":
          e.preventDefault();
          session.toggleCinema(false);
          session.setTab("chat");
          requestAnimationFrame(() => document.getElementById("chat-input")?.focus());
          return;
        case "?":
          session.openDialog("help");
          return;
        default:
          if (/^[1-7]$/.test(e.key)) session.react(REACTIONS[Number(e.key) - 1]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);
}
