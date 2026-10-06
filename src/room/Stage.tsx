import { Loader2, MicOff, Play, RotateCcw, VolumeX } from "lucide-react";
import {
  useCallback,
  type CSSProperties,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { formatDelta, formatTime } from "../../shared/format";
import { compareMedia } from "../../shared/media";
import { canControl } from "../../shared/protocol";
import { Avatar } from "../art/Avatar";
import { Mascot } from "../art/Mascot";
import { cx } from "../lib/cx";
import { Badge } from "../ui/Badge";
import { PixelButton } from "../ui/PixelButton";
import { CallFace } from "./CallBubbles";
import { useRoom, useSession } from "./context";
import { Controls, toggleFullscreen } from "./Controls";

/** The screen: the movie first, everything else floating around it. */
export function Stage() {
  const adapter = useRoom((s) => s.media?.adapter ?? null);
  const playing = useRoom((s) => (s.pending?.playback ?? s.room?.playback)?.status === "playing");
  const stageRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const [awake, setAwake] = useState(true);
  const idleTimer = useRef(0);

  // The <video> belongs to the media adapter; the stage just hosts it.
  useEffect(() => {
    const mount = mountRef.current;
    const video = adapter?.element;
    if (!mount || !video) return;
    mount.appendChild(video);
    return () => {
      if (video.parentElement === mount) mount.removeChild(video);
    };
  }, [adapter]);

  const wake = useCallback((holdMs = 2800) => {
    setAwake(true);
    clearTimeout(idleTimer.current);
    const sleep = () => {
      // Stay up while the viewer is using the controls: hovering, keyboard focus, an open popover.
      const busy = stageRef.current?.querySelector(".controls:hover, .controls :focus-visible, .pop__panel, .bubble__card");
      if (busy) idleTimer.current = window.setTimeout(sleep, 1000);
      else setAwake(false);
    };
    idleTimer.current = window.setTimeout(sleep, holdMs);
  }, []);

  const awakeRef = useRef(awake);
  awakeRef.current = awake;
  const lastPointer = useRef<string>("mouse");

  /** Touch has no hover to wake the controls, so a tap on the picture toggles them. */
  const tapStage = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") return;
      if (awakeRef.current) {
        clearTimeout(idleTimer.current);
        setAwake(false);
      } else {
        wake(5000);
      }
    },
    [wake],
  );

  useEffect(() => {
    if (playing) wake();
    else {
      clearTimeout(idleTimer.current);
      setAwake(true);
    }
    return () => clearTimeout(idleTimer.current);
  }, [playing, wake]);

  return (
    <div
      ref={stageRef}
      className={cx("stage", playing && !awake && "is-idle")}
      onPointerMove={(e) => {
        if (e.pointerType === "mouse") wake();
      }}
      onPointerDown={(e) => {
        lastPointer.current = e.pointerType;
        // Touch taps on the controls themselves should keep them up, but not toggle.
        if (e.pointerType !== "mouse" && (e.target as HTMLElement).closest(".controls, .bubbles")) wake(5000);
        else if (e.pointerType === "mouse") wake();
      }}
      onFocus={() => wake()}
      onDoubleClick={(e) => {
        // Double-click is a desktop gesture. On touch it would collide with
        // tapping twice to show then hide the controls, so the button handles it there.
        if (lastPointer.current !== "mouse") return;
        if ((e.target as HTMLElement).closest(".stage__mount, .stage__click")) toggleFullscreen(stageRef.current);
      }}
    >
      <div ref={mountRef} className="stage__mount" />
      <div className="stage__click" aria-hidden="true" onPointerUp={tapStage} />
      {!adapter && <NoMedia />}
      <Reactions />
      <ChatOverlay />
      <Bubbles />
      <Center />
      <Controls stageRef={stageRef} />
    </div>
  );
}

function NoMedia() {
  const session = useSession();
  return (
    <div className="center">
      <div className="center-card frame">
        <Mascot pose="laptop" scale={4} />
        <p className="pixel center-card__title">No media loaded</p>
        <p className="center-card__text">Pick your copy of the movie to join the room's playback.</p>
        <PixelButton onClick={() => session.openDialog("media")}>Choose file</PixelButton>
      </div>
    </div>
  );
}

function Reactions() {
  const floats = useRoom((s) => s.floats);
  return (
    <div className="reactions" aria-hidden="true">
      {floats.map((f) => (
        <span key={f.id} className="reaction" style={{ left: `${f.x}%` }}>
          {f.emoji}
          {f.name && <small>{f.name}</small>}
        </span>
      ))}
    </div>
  );
}

function ChatOverlay() {
  const items = useRoom((s) => s.overlay);
  const cinema = useRoom((s) => s.ui.cinema);
  if (!cinema) return null;
  return (
    <div className="overlay-chat" role="log" aria-live="polite" aria-label="New messages">
      {items.map((i) =>
        i.kind === "message" ? (
          <p key={i.id}>
            <b>{i.name}</b> {i.text}
          </p>
        ) : null,
      )}
    </div>
  );
}

function Bubbles() {
  const room = useRoom((s) => s.room);
  const me = useRoom((s) => s.me);
  const call = useRoom((s) => s.call);
  const callSize = useRoom((s) => s.prefs.callSize);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".bubble")) setOpen(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (!room) return null;
  const people = room.participants.filter((p) => p.online || p.leftAt !== null);
  // "self" is how the meter labels our own microphone.
  const talking = new Set(call.speaking.map((k) => (k === "self" ? me : k)));
  const streamOf = (pid: string) =>
    pid === me ? call.local : (call.peers.find((x) => x.pid === pid)?.stream ?? null);
  const peerStatus = (pid: string) => call.peers.find((x) => x.pid === pid)?.status ?? null;
  // Faces in the call follow the viewer's chosen size; everyone else stays a small marker.
  const anyInCall = people.some((p) => p.call?.on && p.online);
  return (
    <div
      className="bubbles"
      aria-label="People watching"
      style={anyInCall ? ({ ["--call-face" as string]: `${callSize}px` } as CSSProperties) : undefined}
    >
      {people.map((p) => {
        const match = p.media && room.media ? compareMedia(room.media, p.media).match : null;
        const state = !p.online
          ? { tone: "idle" as const, text: "Reconnecting…" }
          : match === "mismatch" || p.sync === "mismatch"
            ? { tone: "danger" as const, text: "Different file" }
            : p.sync === "buffering"
              ? { tone: "warn" as const, text: "Buffering" }
              : p.sync === "catching_up"
                ? { tone: "warn" as const, text: "Catching up" }
                : !p.media
                  ? { tone: "idle" as const, text: "No media yet" }
                  : room.playback.lag !== null
                    ? // Live: how far behind the broadcast, since there is no shared position.
                      { tone: "ok" as const, text: p.lag === null ? "Live" : `${p.lag.toFixed(1)}s behind live` }
                    : { tone: "ok" as const, text: p.drift !== null && p.sync === "synced" ? `Synced ${Math.abs(p.drift)}ms` : "Synced" };
        const inCall = !!p.call?.on && p.online;
        const stream = inCall ? streamOf(p.id) : null;
        const status = p.id === me ? null : peerStatus(p.id);
        const callText = !inCall
          ? ""
          : status === "failed"
            ? ". Couldn't connect to them"
            : `. In the call${p.call?.muted ? ", muted" : ""}${p.call?.video ? ", camera on" : ""}`;
        return (
          <div key={p.id} className={cx("bubble", !p.online && "is-offline", inCall && "is-call")}>
            <button
              type="button"
              className={cx(
                "bubble__btn",
                inCall && "bubble__btn--call",
                talking.has(p.id) && "is-speaking",
                inCall && status === "failed" && "is-noroute",
              )}
              aria-expanded={open === p.id}
              aria-label={`${p.name}${p.id === me ? " (you)" : ""}: ${state.text}${callText}`}
              onClick={() => setOpen((o) => (o === p.id ? null : p.id))}
            >
              {inCall ? (
                <CallFace seed={p.avatar} stream={stream} video={!!p.call?.video} size={callSize} self={p.id === me} />
              ) : (
                <Avatar seed={p.avatar} size={inCall ? callSize : 40} tone={state.tone} />
              )}
              {inCall && p.call?.muted && (
                <span className="bubble__mic" aria-hidden="true">
                  <MicOff size={11} />
                </span>
              )}
            </button>
            <span className="bubble__name">{p.id === me ? "You" : p.name}</span>
            {open === p.id && (
              <div className="bubble__card frame">
                <p className="bubble__card-name">
                  {p.name}
                  {p.id === me && <em> (you)</em>}
                </p>
                <div className="bubble__tags">
                  {p.host && <span className="tag">Host</span>}
                  {!p.host && canControl(p, room.settings) && <span className="tag">Can control</span>}
                </div>
                <Badge tone={state.tone === "idle" ? "muted" : state.tone}>{state.text}</Badge>
                {inCall && status === "failed" && <Badge tone="danger">Call didn't connect</Badge>}
                {inCall && status === "connecting" && <Badge tone="warn">Call connecting…</Badge>}
                {p.media && <p className="bubble__file">{p.media.name}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Whatever needs the middle of the screen right now. */
function Center() {
  const session = useSession();
  const room = useRoom((s) => s.room);
  const media = useRoom((s) => s.media);
  const phase = useRoom((s) => s.sync.phase);
  const countdownMs = useRoom((s) => s.sync.countdownMs);
  const autoMuted = useRoom((s) => s.sync.autoMuted);
  const target = useRoom((s) => Math.floor(s.sync.target));
  const flash = useStartFlash(phase, countdownMs);
  if (!room || !media) return null;

  const control = session.canControl();
  const cmp = room.media ? compareMedia(room.media, media.fingerprint) : null;

  let main: ReactNode = null;
  if (!room.media) {
    main = (
      <div className="center-card frame">
        <p className="pixel center-card__title">Waiting for the movie</p>
        <p className="center-card__text">The host hasn't picked the room's file yet.</p>
      </div>
    );
  } else if (phase === "countdown" && (countdownMs ?? 0) > 450) {
    main = <Countdown ms={countdownMs!} />;
  } else if (flash) {
    main = (
      <div className="countdown">
        <span className="countdown__n countdown__n--go pixel">▶ Play</span>
      </div>
    );
  } else if (!room.playback.started) {
    main = <ReadyCheck />;
  } else if (phase === "blocked") {
    main = (
      <button type="button" className="tapjoin" onClick={() => session.unlockAudio()}>
        <Play size={28} fill="currentColor" />
        <span className="pixel">Tap to join playback</span>
      </button>
    );
  } else if (phase === "ended") {
    main = (
      <div className="center-card frame">
        <p className="pixel center-card__title">The end</p>
        <p className="center-card__text">Roll credits. Check the Moments tab for the scenes that broke the room.</p>
        {control && (
          <PixelButton icon={<RotateCcw size={16} />} onClick={() => session.seek(0)}>
            Back to the start
          </PixelButton>
        )}
      </div>
    );
  } else if (phase === "paused") {
    main = control ? (
      <button type="button" className="bigplay" onClick={() => session.play()} aria-label="Play for everyone">
        <Play size={34} fill="currentColor" />
      </button>
    ) : (
      <span className="pill">❚❚ Paused · {formatTime(target, true)}</span>
    );
  }

  return (
    <>
      <div className="center">{main}</div>
      <div className="toppills">
        {cmp?.match === "mismatch" && (
          <span className="pill pill--danger">
            ⚠ Your file differs from the room's ({formatDelta(cmp.durationDelta)})
          </span>
        )}
        {autoMuted && (
          <button type="button" className="pill pill--button" onClick={() => session.toggleMute()}>
            <VolumeX size={14} /> Sound is off — tap to unmute
          </button>
        )}
        {phase === "buffering" && (
          <span className="pill">
            <Loader2 size={14} className="spin" /> Buffering…
          </span>
        )}
      </div>
    </>
  );
}

/** A brief "▶ PLAY" after a real countdown (not after the short lead of an ordinary resume). */
function useStartFlash(phase: string, countdownMs: number | null): boolean {
  const [flash, setFlash] = useState(false);
  const wasCounting = useRef(false);
  useEffect(() => {
    if (phase === "countdown" && (countdownMs ?? 0) > 1000) wasCounting.current = true;
    else if (phase !== "countdown" && wasCounting.current) {
      wasCounting.current = false;
      setFlash(true);
    }
  }, [phase, countdownMs]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(false), 800);
    return () => clearTimeout(t);
  }, [flash]);
  return flash;
}

function Countdown({ ms }: { ms: number }) {
  const label = ms > 3000 ? "Ready?" : String(Math.ceil(ms / 1000));
  return (
    <div className="countdown" role="timer" aria-live="assertive">
      <span key={label} className="countdown__n pixel">
        {label}
      </span>
      <span className="countdown__sub">Everyone starts on the same frame</span>
    </div>
  );
}

function ReadyCheck() {
  const session = useSession();
  const room = useRoom((s) => s.room);
  const me = useRoom((s) => s.me);
  const media = useRoom((s) => s.media);
  if (!room) return null;

  const self = room.participants.find((p) => p.id === me);
  const online = room.participants.filter((p) => p.online);
  const ready = online.filter((p) => p.ready).length;
  const control = session.canControl();
  const policy = room.settings.autoStart;
  const hint =
    policy === "off"
      ? "Auto-start is off — someone with control starts the show."
      : online.length < 2
        ? "Auto-start needs at least two people. Or start right now."
        : policy === "all"
          ? "Starts by itself when everyone here is ready."
          : "Starts by itself when most people are ready.";

  return (
    <div className="ready frame" role="region" aria-labelledby="ready-title">
      <div className="ready__head">
        <p id="ready-title" className="ready__title pixel">
          Everyone ready?
        </p>
        <span className="ready__count tnum">
          {ready}/{online.length}
        </span>
      </div>
      <ul className="ready__list">
        {online.map((p) => {
          const mismatch = p.media && room.media && compareMedia(room.media, p.media).match === "mismatch";
          const state = !p.media
            ? { cls: "wait", text: "◌ Loading media" }
            : p.ready
              ? { cls: "ok", text: "✓ Ready" }
              : mismatch
                ? { cls: "bad", text: "⚠ Different file" }
                : { cls: "wait", text: "◌ Not ready" };
          return (
            <li key={p.id}>
              <Avatar seed={p.avatar} size={26} tone={p.ready ? "ok" : "idle"} />
              <span className="ready__name">
                {p.name}
                {p.id === me && <em> (you)</em>}
              </span>
              <span className={cx("ready__state", `is-${state.cls}`)}>{state.text}</span>
            </li>
          );
        })}
      </ul>
      <PixelButton
        size="lg"
        block
        variant={self?.ready ? "ghost" : "primary"}
        disabled={!media}
        onClick={() => session.setReady(!self?.ready)}
      >
        {self?.ready ? "✓ Ready — tap to undo" : "I'm ready"}
      </PixelButton>
      {control && (
        <div className="ready__host">
          {self?.host && (
            <div className="segmented" role="radiogroup" aria-label="Start automatically when">
              {(
                [
                  ["all", "All ready"],
                  ["most", "Most ready"],
                  ["off", "Manual"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={policy === value}
                  onClick={() => session.updateRoom({ settings: { autoStart: value } })}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <PixelButton variant="warm" size="sm" onClick={() => session.startNow()}>
            Start now
          </PixelButton>
        </div>
      )}
      <p className="ready__hint">{hint}</p>
    </div>
  );
}
