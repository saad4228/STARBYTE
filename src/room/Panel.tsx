import { Check, Copy, SendHorizontal, MicOff } from "lucide-react";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { LIMITS } from "../../shared/constants";
import { formatTime } from "../../shared/format";
import { compareMedia } from "../../shared/media";
import { canControl, type ParticipantPublic, type RoomSnapshot } from "../../shared/protocol";
import { Avatar } from "../art/Avatar";
import { Mascot } from "../art/Mascot";
import { cx } from "../lib/cx";
import { Badge } from "../ui/Badge";
import { CallFace, CallPanel } from "./CallBubbles";
import { useRoom, useSession } from "./context";

function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The social side of the room: chat, people, moments. Hidden in cinema mode on desktop. */
export function Panel() {
  const session = useSession();
  const tab = useRoom((s) => s.ui.tab);
  const unread = useRoom((s) => s.ui.unread);
  const online = useRoom((s) => s.room?.participants.filter((p) => p.online).length ?? 0);
  const moments = useRoom((s) => s.room?.moments.length ?? 0);
  const tabs = [
    { id: "chat" as const, label: "Chat", count: unread || null, highlight: unread > 0 },
    { id: "people" as const, label: "People", count: online, highlight: false },
    { id: "moments" as const, label: "Moments", count: moments || null, highlight: false },
  ];
  return (
    <aside className="panel" aria-label="Chat, people and moments">
      <PeopleStrip />
      <div className="panel__tabs" role="tablist" aria-label="Room panel">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className={cx("panel__tab", tab === t.id && "is-active")}
            onClick={() => session.setTab(t.id)}
          >
            {t.label}
            {t.count !== null && <span className={cx("panel__count", t.highlight && "is-hot")}>{t.count}</span>}
          </button>
        ))}
      </div>
      {tab === "chat" && <ChatTab />}
      {tab === "people" && <PeopleTab />}
      {tab === "moments" && <MomentsTab />}
    </aside>
  );
}

/**
 * Mobile: a horizontal strip of who's here, above the tabs. It doubles as the call row on a
 * phone — a camera shows here rather than over the picture, where there is no room for it.
 */
function PeopleStrip() {
  const participants = useRoom((s) => s.room?.participants);
  const me = useRoom((s) => s.me);
  const call = useRoom((s) => s.call);
  if (!participants) return null;
  const talking = new Set(call.speaking.map((k) => (k === "self" ? me : k)));
  const streamOf = (pid: string) => (pid === me ? call.local : (call.peers.find((x) => x.pid === pid)?.stream ?? null));

  return (
    <ul className="strip" aria-label="People watching">
      {participants
        .filter((p) => p.online)
        .map((p) => {
          const inCall = !!p.call?.on;
          return (
            <li key={p.id} className={cx(inCall && "is-call", talking.has(p.id) && "is-speaking")}>
              {inCall ? (
                <span className="strip__face">
                  <CallFace seed={p.avatar} stream={streamOf(p.id)} video={!!p.call?.video} size={30} self={p.id === me} />
                  {p.call?.muted && (
                    <i className="strip__mic" aria-hidden="true">
                      <MicOff size={9} />
                    </i>
                  )}
                </span>
              ) : (
                <Avatar seed={p.avatar} size={30} tone={p.sync === "catching_up" || p.sync === "buffering" ? "warn" : p.sync === "mismatch" ? "danger" : "ok"} />
              )}
              <span>{p.id === me ? "You" : p.name}</span>
            </li>
          );
        })}
    </ul>
  );
}

function ChatTab() {
  const session = useSession();
  const chat = useRoom((s) => s.chat);
  const me = useRoom((s) => s.me);
  const participants = useRoom((s) => s.room?.participants);
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (session.chat(text)) {
      setText("");
      stick.current = true;
    }
  };
  const avatarOf = (pid: string) => participants?.find((p) => p.id === pid)?.avatar ?? seedFromId(pid);

  return (
    <div className="chat" id="panel-chat" role="tabpanel" aria-labelledby="tab-chat">
      <div
        ref={list}
        className="chat__list"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
        onScroll={() => {
          const el = list.current!;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {chat.length === 0 && (
          <div className="chat__empty">
            <Mascot pose="popcorn" scale={3} bob={false} />
            <p>No messages yet. Say hi before the lights go down.</p>
          </div>
        )}
        {chat.map((item) =>
          item.kind === "system" ? (
            <p key={item.id} className="chat__sys">
              {item.text}
            </p>
          ) : (
            <div key={item.id} className={cx("msg", item.pid === me && "msg--mine")}>
              <Avatar seed={avatarOf(item.pid)} size={28} />
              <div className="msg__body">
                <p className="msg__meta">
                  <b>{item.pid === me ? "You" : item.name}</b>
                  <time dateTime={new Date(item.at).toISOString()}>
                    {new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </time>
                </p>
                <p className="msg__text">{item.text}</p>
              </div>
            </div>
          ),
        )}
      </div>
      <form className="chat__form" onSubmit={send}>
        <input
          id="chat-input"
          className="input chat__input"
          placeholder="Say something…"
          value={text}
          maxLength={LIMITS.chatMax}
          autoComplete="off"
          aria-label="Message"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="ibtn chat__send" disabled={!text.trim()} aria-label="Send message">
          <SendHorizontal />
        </button>
      </form>
    </div>
  );
}

function PeopleTab() {
  const session = useSession();
  const room = useRoom((s) => s.room);
  const me = useRoom((s) => s.me);
  if (!room) return null;
  const amHost = !!room.participants.find((p) => p.id === me)?.host;
  const sorted = [...room.participants].sort((a, b) => Number(b.online) - Number(a.online) || a.joinedAt - b.joinedAt);

  return (
    <div className="people" id="panel-people" role="tabpanel" aria-labelledby="tab-people">
      <CallPanel />
      <ul className="people__list">
        {sorted.map((p) => (
          <PersonRow
            key={p.id}
            p={p}
            me={p.id === me}
            room={room}
            onGrant={amHost && !p.host && room.settings.control === "host" ? (v) => session.grant(p.id, v) : undefined}
          />
        ))}
      </ul>
      <p className="people__note">
        {room.settings.control === "everyone"
          ? "Everyone in this room can play, pause and seek."
          : amHost
            ? "Host-only control. Give control to anyone you trust to drive."
            : "Only the host (and people they choose) can control playback."}
      </p>
    </div>
  );
}

function PersonRow({
  p,
  me,
  room,
  onGrant,
}: {
  p: ParticipantPublic;
  me: boolean;
  room: RoomSnapshot;
  onGrant?: (control: boolean) => void;
}) {
  const match = p.media && room.media ? compareMedia(room.media, p.media).match : null;
  const status: { tone: "ok" | "warn" | "danger" | "muted"; text: string } = !p.online
    ? { tone: "muted", text: "Reconnecting…" }
    : !p.media
      ? { tone: "muted", text: "No media yet" }
      : match === "mismatch"
        ? { tone: "danger", text: "Different file" }
        : p.sync === "catching_up"
          ? { tone: "warn", text: "Catching up" }
          : p.sync === "buffering"
            ? { tone: "warn", text: "Buffering" }
            : !room.playback.started
              ? p.ready
                ? { tone: "ok", text: "Ready" }
                : { tone: "muted", text: "Not ready" }
              : { tone: "ok", text: p.drift !== null ? `Synced ${Math.abs(p.drift)}ms` : "Synced" };
  const control = canControl(p, room.settings);

  return (
    <li className={cx("person-row", !p.online && "is-offline")}>
      <Avatar seed={p.avatar} size={36} tone={status.tone === "muted" ? "idle" : status.tone} />
      <div className="person-row__main">
        <p className="person-row__name">
          {p.name}
          {me && <em> (you)</em>}
        </p>
        <p className="person-row__file">{p.media ? `${p.media.name} · ${formatTime(p.media.duration, true)}` : "—"}</p>
        <div className="person-row__tags">
          {p.host && <span className="tag">Host</span>}
          {!p.host && control && <span className="tag">Can control</span>}
          <Badge tone={status.tone} ring={status.tone === "muted"}>
            {status.text}
          </Badge>
        </div>
      </div>
      {onGrant && (
        <button type="button" className="mini-btn" onClick={() => onGrant(!p.granted)}>
          {p.granted ? "Revoke control" : "Give control"}
        </button>
      )}
    </li>
  );
}

function MomentsTab() {
  const session = useSession();
  const moments = useRoom((s) => s.room?.moments);
  const [copied, setCopied] = useState(false);
  if (!moments) return null;
  const sorted = [...moments].sort((a, b) => a.position - b.position);
  const control = session.canControl();

  const copy = async () => {
    const text = sorted
      .map((m) => `${formatTime(m.position, true)}  ${m.emoji}  ${m.caption || "(no caption)"} — ${m.name}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      session.toast("warn", "Couldn't copy — your browser blocked clipboard access.");
    }
  };

  return (
    <div className="moments-tab" id="panel-moments" role="tabpanel" aria-labelledby="tab-moments">
      {sorted.length === 0 ? (
        <div className="chat__empty">
          <p className="pixel moments-tab__empty">No moments yet</p>
          <p>Press ✦ Mark moment (or S) when a scene breaks the room. Everyone sees it here.</p>
        </div>
      ) : (
        <>
          <ol className="moments-tab__list">
            {sorted.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="moment-row"
                  disabled={!control}
                  onClick={() => session.seek(m.position)}
                  title={control ? "Jump everyone here" : undefined}
                >
                  <span className="moment-row__emoji" aria-hidden="true">
                    {m.emoji}
                  </span>
                  <span className="moment-row__time tnum">{formatTime(m.position, true)}</span>
                  <span className="moment-row__caption">{m.caption || <i>No caption</i>}</span>
                  <span className="moment-row__by">{m.name}</span>
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="mini-btn moments-tab__copy" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy as list"}
          </button>
        </>
      )}
    </div>
  );
}
