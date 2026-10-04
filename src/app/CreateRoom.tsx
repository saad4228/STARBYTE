import { ArrowRight } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { LIMITS } from "../../shared/constants";
import { cleanText } from "../../shared/format";
import type { ControlMode } from "../../shared/protocol";
import { Mascot } from "../art/Mascot";
import { Pixel } from "../art/Pixel";
import { icons } from "../art/sprites";
import { navigate } from "../lib/router";
import { PixelButton } from "../ui/PixelButton";
import { ApiError, createRoom } from "./api";
import { AppShell, Field, Notice } from "./AppShell";
import { loadName, saveHostKey, saveName, suggestName } from "./identity";

const SOURCES = [
  { id: "local", icon: icons.local, title: "Local file", desc: "Everyone plays their own copy. Nothing is uploaded." },
  { id: "drive", icon: icons.cloud, title: "Google Drive", desc: "Share one link; the whole room plays that file." },
  { id: "link", icon: icons.stream, title: "Direct link", desc: "Any https video URL the browser can open." },
] as const;

export default function CreateRoom() {
  const [roomName, setRoomName] = useState("Friday Night");
  const [name, setName] = useState(() => loadName());
  const [placeholder] = useState(() => suggestName());
  const [control, setControl] = useState<ControlMode>("everyone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    document.title = "Create a room — STARBYTE";
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const hostName = cleanText(name, LIMITS.nameMax) || placeholder;
    try {
      saveName(hostName);
      const { roomId, hostKey } = await createRoom({
        name: cleanText(roomName, LIMITS.roomNameMax) || "Movie Night",
        hostName,
        control,
      });
      saveHostKey(roomId, hostKey);
      navigate(`/r/${roomId}`);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      if (apiError?.code === "capacity") {
        setError({
          title: "Free-tier capacity reached",
          message: "STARBYTE runs on free infrastructure and today's room quota is used up. Please try again later.",
        });
      } else if (apiError?.code === "rate_limited") {
        setError({ title: "Slow down a little", message: apiError.message });
      } else {
        setError({ title: "Couldn't create the room", message: apiError?.message ?? "Please try again." });
      }
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="create">
        <header className="page-head">
          <p className="eyebrow">✦ New room</p>
          <h1 className="page-title pixel">Create room</h1>
          <p className="page-sub">Name it, choose who drives, share the link. Takes ten seconds.</p>
        </header>

        <form className="frame form-card create__form" onSubmit={submit} noValidate>
          <Field label="Room name" htmlFor="room-name">
            <input
              id="room-name"
              className="input"
              value={roomName}
              maxLength={LIMITS.roomNameMax}
              onChange={(e) => setRoomName(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Your name" htmlFor="host-name" hint="Shown to everyone in the room.">
            <input
              id="host-name"
              className="input"
              value={name}
              placeholder={placeholder}
              maxLength={LIMITS.nameMax}
              onChange={(e) => setName(e.target.value)}
              autoComplete="nickname"
            />
          </Field>

          {/* Not a choice made here: the source is picked in the lobby, where it can be
              checked before the room commits to it. This just says what's on offer. */}
          <div className="field">
            <span className="field__label">Media sources</span>
            <ul className="srclist">
              {SOURCES.map((s) => (
                <li key={s.id}>
                  <Pixel sprite={s.icon} scale={2} />
                  <span className="srclist__body">
                    <span className="srclist__title">{s.title}</span>
                    <span className="srclist__desc">{s.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="field__hint">You'll choose in the lobby, once the room exists.</p>
          </div>

          <fieldset className="tiles">
            <legend className="field__label">Room control</legend>
            <label className="tile">
              <input type="radio" name="control" checked={control === "everyone"} onChange={() => setControl("everyone")} />
              <span className="tile__mark" aria-hidden="true" />
              <span className="tile__body">
                <span className="tile__title">Anyone can control</span>
                <span className="tile__desc">Everyone can play, pause and seek. Best for friends.</span>
              </span>
            </label>
            <label className="tile">
              <input type="radio" name="control" checked={control === "host"} onChange={() => setControl("host")} />
              <span className="tile__mark" aria-hidden="true" />
              <span className="tile__body">
                <span className="tile__title">Host only</span>
                <span className="tile__desc">You drive. You can hand control to specific people later.</span>
              </span>
            </label>
          </fieldset>

          {error && (
            <Notice tone="danger" title={error.title}>
              {error.message}
            </Notice>
          )}

          <PixelButton type="submit" size="lg" block disabled={busy} iconEnd={busy ? undefined : <ArrowRight size={18} strokeWidth={2.5} />}>
            {busy ? "Opening room…" : "Create room"}
          </PixelButton>
          <p className="fineprint">No account. No upload. Rooms vanish after a day with nobody inside.</p>
        </form>

        <aside className="create__aside" aria-label="How it works">
          <Mascot pose="remote" scale={6} className="create__mascot" />
          <ol className="steps">
            <li>
              <span className="steps__n">1</span>
              <span>
                <strong>Create</strong> the room and pick your movie file.
              </span>
            </li>
            <li>
              <span className="steps__n">2</span>
              <span>
                <strong>Invite</strong> friends — each brings their own copy.
              </span>
            </li>
            <li>
              <span className="steps__n">3</span>
              <span>
                <strong>Ready check</strong>, 3 · 2 · 1, and you're watching together.
              </span>
            </li>
          </ol>
        </aside>
      </div>
    </AppShell>
  );
}
