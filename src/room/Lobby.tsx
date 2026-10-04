import { Check, Copy, LogOut } from "lucide-react";
import { useState } from "react";
import { formatRoomId } from "../../shared/ids";
import { compareMedia } from "../../shared/media";
import { formatTime } from "../../shared/format";
import type { MediaFingerprint, ParticipantPublic } from "../../shared/protocol";
import { Avatar } from "../art/Avatar";
import { inviteUrl } from "../app/api";
import { AppShell, Notice } from "../app/AppShell";
import { cx } from "../lib/cx";
import { Badge } from "../ui/Badge";
import { useRoom, useSession } from "./context";
import { MediaPanel } from "./MediaPanel";
import { ConnPill } from "./parts";

/** Before the cinema: bring your media, see who's here, share the link. */
export function Lobby() {
  const session = useSession();
  const roomId = useRoom((s) => s.roomId);
  const room = useRoom((s) => s.room);
  const info = useRoom((s) => s.info);
  const started = room?.playback.started && room.playback.status === "playing";

  return (
    <AppShell
      wide
      back={null}
      aside={
        <>
          <ConnPill />
          <button type="button" className="app__back" onClick={() => session.leave()}>
            <LogOut size={15} aria-hidden="true" /> Leave
          </button>
        </>
      }
    >
      <div className="lobby">
        <header className="lobby__head">
          <p className="eyebrow">✦ Room {formatRoomId(roomId)}</p>
          <h1 className="page-title pixel">{room?.name ?? info?.name ?? "Room"}</h1>
          {started && (
            <Notice title="Already playing">
              The movie is underway. Pick your file and you'll drop in at exactly the right moment.
            </Notice>
          )}
        </header>
        <div className="lobby__grid">
          <MediaPanel onEnter={() => session.enter()} />
          <aside className="lobby__side">
            <InviteCard roomId={roomId} />
            <PresenceCard />
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

export function InviteCard({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  const participants = useRoom((s) => s.room?.participants);
  const alone = (participants?.filter((p) => p.online).length ?? 0) <= 1;
  const link = inviteUrl(roomId);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const input = document.getElementById("invite-link") as HTMLInputElement | null;
      input?.select();
      document.execCommand("copy");
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section className="frame invite" aria-labelledby="invite-title">
      <h2 id="invite-title" className="card-title pixel">
        {alone ? "Room ready" : "Invite more"}
      </h2>
      <p className="invite__code pixel" aria-label={`Room code ${roomId.split("").join(" ")}`}>
        {formatRoomId(roomId)}
      </p>
      <div className="invite__row">
        <input id="invite-link" className="input invite__link" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
        <button type="button" className="invite__copy" onClick={copy}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {alone && (
        <p className="invite__waiting">
          <span className="invite__pulse" aria-hidden="true" /> Waiting for friends…
        </p>
      )}
      <p className="invite__hint">Friends need their own copy of the movie.</p>
    </section>
  );
}

export function PresenceCard() {
  const room = useRoom((s) => s.room);
  const me = useRoom((s) => s.me);
  if (!room) {
    return (
      <section className="frame presence">
        <h2 className="card-title pixel">In the room</h2>
        <p className="presence__empty">Connecting…</p>
      </section>
    );
  }
  const people = room.participants.filter((p) => p.online || p.leftAt !== null);
  return (
    <section className="frame presence" aria-labelledby="presence-title">
      <h2 id="presence-title" className="card-title pixel">
        In the room <span className="card-title__count">{room.participants.filter((p) => p.online).length}</span>
      </h2>
      <ul className="presence__list">
        {people.map((p) => (
          <PresenceRow key={p.id} p={p} me={p.id === me} reference={room.media} started={room.playback.started} />
        ))}
      </ul>
    </section>
  );
}

function PresenceRow({
  p,
  me,
  reference,
  started,
}: {
  p: ParticipantPublic;
  me: boolean;
  reference: MediaFingerprint | null;
  started: boolean;
}) {
  const match = p.media && reference ? compareMedia(reference, p.media).match : null;
  let status: { tone: "ok" | "warn" | "danger" | "muted"; text: string };
  if (!p.online) status = { tone: "muted", text: "Reconnecting" };
  else if (!p.media) status = { tone: "muted", text: "Choosing a file" };
  else if (match === "mismatch") status = { tone: "danger", text: "Different file" };
  else if (!started && p.ready) status = { tone: "ok", text: "Ready" };
  else status = { tone: "ok", text: match === "compatible" ? "Compatible" : "Media matched" };

  return (
    <li className={cx("presence__row", !p.online && "is-offline")}>
      <Avatar seed={p.avatar} size={34} tone={status.tone === "muted" ? "idle" : status.tone === "danger" ? "danger" : "ok"} />
      <span className="presence__who">
        <span className="presence__name">
          {p.name}
          {me && <em> (you)</em>}
        </span>
        <span className="presence__file">
          {p.media ? `${p.media.name} · ${formatTime(p.media.duration, true)}` : "—"}
        </span>
      </span>
      <span className="presence__tags">
        {p.host && <span className="tag">Host</span>}
        <Badge tone={status.tone} ring={status.tone === "muted"}>
          {status.text}
        </Badge>
      </span>
    </li>
  );
}
