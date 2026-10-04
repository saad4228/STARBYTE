import { useEffect, useRef, useState } from "react";
import { Mascot } from "../art/Mascot";
import { cx } from "../lib/cx";
import { prefersReducedMotion } from "../lib/router";
import { PixelButton } from "../ui/PixelButton";
import { useRoom, useSession } from "./context";
import { StepIcon } from "./parts";

const STEP_MS = 380;

/**
 * The game-loading-screen moment. Each check waits for the real condition — a live socket,
 * the room snapshot, a playable file, a measured clock — then the next one lights up.
 */
export function Entering() {
  const session = useSession();
  const conn = useRoom((s) => s.conn);
  const room = useRoom((s) => s.room);
  const me = useRoom((s) => s.me);
  const media = useRoom((s) => s.media);
  const enterRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState(0);

  const cmp = session.comparison();
  const online = room?.participants.filter((p) => p.online).length ?? 0;
  const checks = [
    {
      label: "Checking connection",
      ok: conn.status === "open",
      detail: conn.rtt !== null ? `${Math.round(conn.rtt)} ms` : "",
    },
    { label: "Checking room", ok: !!room && !!me, detail: room ? `${online} online` : "" },
    {
      label: "Checking media",
      ok: !!media,
      warn: cmp?.match === "mismatch",
      detail: !room?.media ? "waiting for host" : cmp ? (cmp.match === "mismatch" ? "different file" : cmp.match) : "",
    },
    {
      label: "Checking synchronization",
      ok: conn.clockReady,
      detail: conn.clockReady && conn.rtt !== null ? `±${Math.max(1, Math.round(conn.rtt / 2))} ms` : "",
    },
  ];
  const current = checks[step];
  const done = step >= checks.length;

  useEffect(() => {
    if (!current?.ok) return;
    const t = window.setTimeout(() => setStep((s) => s + 1), prefersReducedMotion() ? 0 : STEP_MS);
    return () => clearTimeout(t);
  }, [step, current?.ok]);

  useEffect(() => {
    if (done) enterRef.current?.focus();
  }, [done]);

  return (
    <main className="entering">
      <div className="entering__scan" aria-hidden="true" />
      <div className="frame entering__panel">
        <Mascot pose={done ? "popcorn" : "idle"} scale={4} className="entering__mascot" />
        <h1 className="entering__title pixel" aria-live="polite">
          {done ? "Cinema ready" : "Entering cinema…"}
        </h1>
        <ul className="checks checks--big">
          {checks.map((c, i) => {
            const status = i < step ? (c.warn ? "warn" : "ok") : i === step ? "active" : "pending";
            return (
              <li key={c.label} className={cx("check", `check--${status === "active" ? "pending" : status}`, i > step && "is-hidden")}>
                <span className="check__icon">
                  <StepIcon status={status} />
                </span>
                <span className="check__label">{c.label}</span>
                <span className="check__value tnum">{i < step ? c.detail : ""}</span>
              </li>
            );
          })}
        </ul>
        <PixelButton ref={enterRef} size="lg" block disabled={!done} onClick={() => session.enterRoom()}>
          Enter
        </PixelButton>
        <button type="button" className="link-btn entering__back" onClick={() => session.backToLobby()}>
          Back to lobby
        </button>
      </div>
    </main>
  );
}
