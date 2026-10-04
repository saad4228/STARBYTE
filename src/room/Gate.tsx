import { ArrowRight, Film } from "lucide-react";
import { useState, type FormEvent } from "react";
import { LIMITS } from "../../shared/constants";
import { formatTime } from "../../shared/format";
import { Mascot } from "../art/Mascot";
import { AppShell, Field, Notice } from "../app/AppShell";
import { loadName, suggestName } from "../app/identity";
import { PixelButton } from "../ui/PixelButton";
import { useRoom, useSession } from "./context";

/** The invitation card: who's hosting, what's showing, and your name. */
export function Gate() {
  const session = useSession();
  const info = useRoom((s) => s.info);
  const [name, setName] = useState(() => loadName());
  const [placeholder] = useState(() => suggestName());
  if (!info) return null;

  const full = info.online >= info.maxParticipants;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    session.join(name || placeholder);
  };

  return (
    <AppShell>
      <div className="gate">
        <form className="frame form-card gate__card" onSubmit={submit}>
          <p className="eyebrow">✦ You're invited</p>
          <h1 className="gate__title pixel">{info.name}</h1>
          <p className="gate__meta">
            Hosted by <strong>{info.hostName}</strong> · {info.online} {info.online === 1 ? "person" : "people"} inside
            {info.started && " · playing now"}
          </p>
          {info.media && (
            <p className="gate__now">
              <Film size={16} aria-hidden="true" />
              <span>
                Tonight: <strong>{info.media.name}</strong> · {formatTime(info.media.duration, true)}
              </span>
            </p>
          )}
          {full && (
            <Notice tone="warn" title="Room is full">
              It holds {info.maxParticipants} people. You can try again in a moment.
            </Notice>
          )}
          <Field label="Your name" htmlFor="gate-name" hint="This is how friends will see you.">
            <input
              id="gate-name"
              className="input"
              value={name}
              placeholder={placeholder}
              maxLength={LIMITS.nameMax}
              autoComplete="nickname"
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <PixelButton type="submit" size="lg" block iconEnd={<ArrowRight size={18} strokeWidth={2.5} />}>
            Continue
          </PixelButton>
          <p className="fineprint">
            Bring your own copy of the movie. It stays on your device — STARBYTE only syncs playback.
          </p>
        </form>
        <Mascot pose="popcorn" scale={6} className="gate__mascot" />
      </div>
    </AppShell>
  );
}
