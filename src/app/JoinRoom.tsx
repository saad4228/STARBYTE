import { ArrowRight } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { normalizeRoomId } from "../../shared/ids";
import { Mascot } from "../art/Mascot";
import { Link, navigate } from "../lib/router";
import { PixelButton } from "../ui/PixelButton";
import { AppShell } from "./AppShell";

/** Typing a code gets an automatic dash (4H7K-9XQP); pasting a full invite link works too. */
function formatInput(value: string): string {
  if (value.includes("/") || value.includes(".")) return value;
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

export default function JoinRoom() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Join a room — STARBYTE";
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = normalizeRoomId(code);
    if (!id) {
      setError("That doesn't look like a room code. Codes have 8 characters, like 4H7K-9XQP.");
      return;
    }
    navigate(`/r/${id}`);
  };

  return (
    <AppShell>
      <div className="join">
        <Mascot pose="idle" scale={5} className="join__mascot" />
        <header className="page-head page-head--center">
          <p className="eyebrow">✦ Got an invite?</p>
          <h1 className="page-title pixel">Join a room</h1>
          <p className="page-sub">Paste the invite link or type the code your host shared.</p>
        </header>
        <form className="frame form-card join__form" onSubmit={submit} noValidate>
          <label className="visually-hidden" htmlFor="room-code">
            Room code or invite link
          </label>
          <input
            id="room-code"
            className="input input--code"
            value={code}
            placeholder="XXXX-XXXX"
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={error ? "room-code-error" : undefined}
            onChange={(e) => {
              setCode(formatInput(e.target.value));
              setError("");
            }}
          />
          {error && (
            <p id="room-code-error" className="form-error" role="alert">
              {error}
            </p>
          )}
          <PixelButton type="submit" size="lg" block iconEnd={<ArrowRight size={18} strokeWidth={2.5} />}>
            Join room
          </PixelButton>
        </form>
        <p className="join__alt">
          No code? <Link to="/create">Create a room</Link> and invite your people.
        </p>
      </div>
    </AppShell>
  );
}
