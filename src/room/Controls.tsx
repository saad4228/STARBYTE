import {
  Captions,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Smile,
  Star,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { MOMENT_DEFAULT_EMOJI, MOMENT_EMOJI, PLAYBACK_RATES, REACTIONS } from "../../shared/constants";
import { formatPrecise, formatTime } from "../../shared/format";
import type { RoomMoment } from "../../shared/protocol";
import { cx } from "../lib/cx";
import { PixelButton } from "../ui/PixelButton";
import { CallControls } from "./CallBubbles";
import { useRoom, useSession } from "./context";

/** Screen Orientation lock, which only some browsers implement. */
type Orientation = ScreenOrientation & {
  lock?: (o: "landscape") => Promise<void>;
  unlock?: () => void;
};

export function toggleFullscreen(el: HTMLElement | null): void {
  if (!el) return;
  const orientation = screen.orientation as Orientation | undefined;

  if (document.fullscreenElement) {
    orientation?.unlock?.();
    void document.exitFullscreen();
  } else if (el.requestFullscreen) {
    void el
      .requestFullscreen()
      .then(() => {
        // A 16:9 film on an upright phone is a thin strip however much room it is given —
        // the picture is capped by the screen's width. Turning the phone is what actually
        // makes it bigger, so fullscreen does it for you where the browser allows it.
        // iOS has no orientation lock and rejects this; the fullscreen still stands.
        if (matchMedia("(pointer: coarse)").matches && matchMedia("(orientation: portrait)").matches) {
          orientation?.lock?.("landscape").catch(() => {});
        }
      })
      .catch(() => {});
  } else {
    // iPhone Safari: only the video element itself can go fullscreen, and it handles the
    // rotation on its own once it is there.
    const video = el.querySelector("video") as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    video?.webkitEnterFullscreen?.();
  }
}

/** A popover that closes on outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

export function Controls({ stageRef }: { stageRef: RefObject<HTMLDivElement | null> }) {
  const session = useSession();
  const room = useRoom((s) => s.room);
  const hasMedia = useRoom((s) => !!s.media);
  const local = useRoom((s) => s.sync.local);
  const target = useRoom((s) => s.sync.target);
  const phase = useRoom((s) => s.sync.phase);
  const buffered = useRoom((s) => s.sync.buffered);
  const playing = useRoom((s) => (s.pending?.playback ?? s.room?.playback)?.status === "playing");
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  if (!room) return null;
  const control = session.canControl();
  const duration = room.media?.duration ?? 0;
  const position = phase === "idle" ? target : local;
  const long = duration >= 3600;
  const disabledReason = !control ? "Only the host can control playback" : !room.media ? "No media yet" : undefined;

  return (
    <div className="controls">
      <SeekBar
        position={position}
        duration={duration}
        buffered={buffered}
        moments={room.moments}
        disabled={!control || !room.media}
        onSeek={(t) => session.seek(t)}
      />
      <div className="controls__row">
        <div className="controls__group">
          <button
            type="button"
            className="ibtn ibtn--play"
            onClick={() => session.togglePlay()}
            disabled={!control || !room.media || !hasMedia}
            title={disabledReason}
            aria-label={playing ? "Pause for everyone (Space)" : "Play for everyone (Space)"}
          >
            {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </button>
          <button type="button" className="ibtn hide-sm" onClick={() => session.seekBy(-10)} disabled={!control} aria-label="Back 10 seconds (←)">
            <RotateCcw />
          </button>
          <button type="button" className="ibtn hide-sm" onClick={() => session.seekBy(10)} disabled={!control} aria-label="Forward 10 seconds (→)">
            <RotateCw />
          </button>
          <VolumeControl />
          <span className="controls__time tnum">
            {formatTime(position, long)}
            <i> / {formatTime(duration, long)}</i>
          </span>
        </div>

        <div className="controls__group controls__group--social">
          <ReactionBar />
          <MomentButton />
          <CallControls />
        </div>

        <div className="controls__group controls__group--end">
          <SyncIndicator />
          <SubtitlesButton />
          <RateButton disabled={!control} />
          <button
            type="button"
            className="ibtn"
            onClick={() => toggleFullscreen(stageRef.current)}
            aria-label={fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
          >
            {fullscreen ? <Minimize /> : <Maximize />}
          </button>
        </div>
      </div>
    </div>
  );
}

function SeekBar({
  position,
  duration,
  buffered,
  moments,
  disabled,
  onSeek,
}: {
  position: number;
  duration: number;
  buffered: number;
  moments: RoomMoment[];
  disabled: boolean;
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
  };
  const pct = (t: number) => `${duration ? Math.min(100, (t / duration) * 100) : 0}%`;
  const shown = drag ?? position;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(timeAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    if (drag !== null) setDrag(timeAt(e.clientX));
    else setHover(timeAt(e.clientX));
  };
  const onPointerUp = () => {
    if (drag !== null) onSeek(drag);
    setDrag(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step: Record<string, number> = { ArrowLeft: -5, ArrowRight: 5, PageDown: -60, PageUp: 60 };
    if (e.key in step) {
      e.preventDefault();
      onSeek(position + step[e.key]!);
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSeek(Math.max(0, duration - 5));
    }
  };

  return (
    <div
      ref={ref}
      className={cx("seek", disabled && "is-disabled", drag !== null && "is-dragging")}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Seek for everyone"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={formatTime(shown, true)}
      aria-disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
    >
      <div className="seek__rail">
        <div className="seek__buffer" style={{ left: pct(position), width: pct(Math.min(buffered, duration - position)) }} />
        <div className="seek__fill" style={{ width: pct(shown) }} />
        <div className="seek__knob" style={{ left: pct(shown) }} />
      </div>
      {moments.map((m) => (
        <span key={m.id} className="seek__pin" style={{ left: pct(m.position) }} title={`${m.emoji} ${formatTime(m.position, true)} — ${m.name}`}>
          {m.emoji}
        </span>
      ))}
      {(drag ?? hover) !== null && (
        <span className="seek__tip tnum" style={{ left: pct((drag ?? hover)!) }}>
          {formatTime((drag ?? hover)!, true)}
        </span>
      )}
    </div>
  );
}

function VolumeControl() {
  const session = useSession();
  const volume = useRoom((s) => s.prefs.volume);
  const muted = useRoom((s) => s.prefs.muted || s.sync.autoMuted);
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="volume hide-sm">
      <button type="button" className="ibtn" onClick={() => session.toggleMute()} aria-label={muted ? "Unmute (M)" : "Mute (M)"}>
        <Icon />
      </button>
      <input
        type="range"
        className="volume__range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={(e) => session.setVolume(Number(e.target.value))}
        aria-label="Volume"
      />
    </div>
  );
}

function ReactionBar() {
  const session = useSession();
  const pop = usePopover();
  const buttons = REACTIONS.map((e, i) => (
    <button
      key={e}
      type="button"
      className="reactbar__btn"
      onClick={() => session.react(e)}
      aria-label={`React with ${e} (${i + 1})`}
    >
      {e}
    </button>
  ));
  return (
    <>
      <div className="reactbar" role="group" aria-label="Reactions">
        {buttons}
      </div>
      <div className="pop reactpop" ref={pop.ref}>
        <button type="button" className="ibtn" aria-expanded={pop.open} aria-label="Reactions" onClick={() => pop.setOpen((o) => !o)}>
          <Smile />
        </button>
        {pop.open && (
          <div className="pop__panel reactpop__panel" role="group" aria-label="Reactions">
            {buttons}
          </div>
        )}
      </div>
    </>
  );
}

function MomentButton() {
  const session = useSession();
  const pop = usePopover();
  const [position, setPosition] = useState(0);
  const [emoji, setEmoji] = useState(MOMENT_DEFAULT_EMOJI);
  const [caption, setCaption] = useState("");
  const hasRoomMedia = useRoom((s) => !!s.room?.media);

  const openComposer = () => {
    setPosition(session.store.get().sync.target);
    setCaption("");
    pop.setOpen(true);
  };

  useEffect(() => {
    const onMark = () => {
      if (hasRoomMedia) openComposer();
    };
    window.addEventListener("starbyte:mark", onMark);
    return () => window.removeEventListener("starbyte:mark", onMark);
  });

  const save = (e: FormEvent) => {
    e.preventDefault();
    session.mark(emoji, caption, position);
    pop.setOpen(false);
  };

  return (
    <div className="pop" ref={pop.ref}>
      <button
        type="button"
        className="momentbtn"
        disabled={!hasRoomMedia}
        aria-expanded={pop.open}
        onClick={() => (pop.open ? pop.setOpen(false) : openComposer())}
      >
        <Star size={16} />
        <span>Mark moment</span>
      </button>
      {pop.open && (
        <form className="pop__panel composer" onSubmit={save} aria-label="Save a moment">
          <p className="composer__time pixel tnum">✦ {formatTime(position, true)}</p>
          <div className="composer__emoji" role="radiogroup" aria-label="Moment emoji">
            {MOMENT_EMOJI.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={emoji === e} aria-label={e} onClick={() => setEmoji(e)}>
                {e}
              </button>
            ))}
          </div>
          <input
            className="input"
            placeholder="That scene… (optional)"
            maxLength={80}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            autoFocus
            aria-label="Caption"
          />
          <PixelButton type="submit" size="sm" block>
            Save moment
          </PixelButton>
        </form>
      )}
    </div>
  );
}

/** Smooth a jittery number for display (exponential moving average). */
function useSmoothed(value: number | null): number | null {
  const ref = useRef<number | null>(null);
  if (value === null) ref.current = null;
  else ref.current = ref.current === null ? value : ref.current * 0.8 + value * 0.2;
  return ref.current === null ? null : Math.round(ref.current);
}

export function SyncIndicator() {
  const session = useSession();
  const sync = useRoom((s) => s.sync);
  const conn = useRoom((s) => s.conn);
  const room = useRoom((s) => s.room);
  const hasMedia = useRoom((s) => !!s.media);
  const pop = usePopover();
  const drift = useSmoothed(sync.drift === null ? null : Math.abs(sync.drift));
  const cmp = session.comparison();

  let tone: "ok" | "warn" | "danger" | "muted" = "ok";
  let label: string;
  /** Secondary text, dropped on narrow screens so the control row can never overflow. */
  let detail = "";
  if (conn.status !== "open") {
    tone = "warn";
    label = "Offline · local";
  } else if (cmp?.match === "mismatch") {
    tone = "danger";
    label = "Media mismatch";
  } else {
    switch (sync.phase) {
      case "synced":
        label = "Synced";
        detail = `${drift ?? 0}ms`;
        break;
      case "paused":
        label = "Synced · paused";
        break;
      case "lobby":
        tone = "muted";
        label = "Ready check";
        break;
      case "countdown":
        label = "Starting";
        break;
      case "catching_up":
        tone = "warn";
        label = "Catching up";
        if (sync.correction === "nudge") detail = `${sync.rate.toFixed(2)}×`;
        break;
      case "buffering":
        tone = "warn";
        label = "Buffering";
        break;
      case "blocked":
        tone = "danger";
        label = "Tap to play";
        break;
      case "ended":
        tone = "muted";
        label = "The end";
        break;
      default:
        tone = "muted";
        label = hasMedia ? "Idle" : "No media";
    }
  }

  const online = room?.participants.filter((p) => p.online).length ?? 0;
  const correction =
    sync.correction === "nudge" ? `Gentle · ${sync.rate.toFixed(3)}×` : sync.correction === "jump" ? "Jumped to room" : "None needed";

  return (
    <div className="pop" ref={pop.ref}>
      <button
        type="button"
        className={cx("syncbtn", `syncbtn--${tone}`)}
        aria-expanded={pop.open}
        aria-label={`Sync: ${label}${detail ? ` ${detail}` : ""}. Show sync health`}
        onClick={() => pop.setOpen((o) => !o)}
      >
        <i className="syncbtn__dot" aria-hidden="true" />
        <span className="syncbtn__text tnum">
          {label}
          {detail && <i className="syncbtn__detail"> {detail}</i>}
        </span>
      </button>
      {pop.open && (
        <div className="pop__panel hud" role="dialog" aria-label="Sync health">
          <p className="hud__title pixel">Sync health</p>
          <dl className="hud__grid">
            <div>
              <dt>Room position</dt>
              <dd className="tnum">{formatPrecise(sync.target)}</dd>
            </div>
            <div>
              <dt>Your position</dt>
              <dd className="tnum">{formatPrecise(sync.local)}</dd>
            </div>
            <div>
              <dt>Drift</dt>
              <dd className={cx("tnum", sync.drift !== null && Math.abs(sync.drift) < 60 && "is-ok")}>
                {sync.drift === null ? "—" : `${sync.drift > 0 ? "+" : ""}${sync.drift} ms`}
              </dd>
            </div>
            <div>
              <dt>Correction</dt>
              <dd>{correction}</dd>
            </div>
            <div>
              <dt>Buffer</dt>
              <dd className="tnum">{sync.buffered.toFixed(1)} s</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd className="tnum">{conn.rtt === null ? "—" : `${Math.round(conn.rtt)} ms RTT`}</dd>
            </div>
            <div>
              <dt>Clock offset</dt>
              <dd className="tnum">{conn.clockReady ? `${Math.round(session.clock.offsetMs)} ms` : "measuring"}</dd>
            </div>
            <div>
              <dt>Viewers</dt>
              <dd className="tnum">{online}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>Local file</dd>
            </div>
            <div>
              <dt>Media</dt>
              <dd className={cx(cmp?.match !== "mismatch" && "is-ok")}>
                {cmp ? (cmp.match === "identical" ? "Matched" : cmp.match === "compatible" ? "Compatible" : "Mismatch") : "—"}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

function SubtitlesButton() {
  const session = useSession();
  const subtitles = useRoom((s) => s.media?.subtitles ?? null);
  const visible = useRoom((s) => s.prefs.subtitlesVisible);
  const pop = usePopover();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="pop pop--subs" ref={pop.ref}>
      <button
        type="button"
        className={cx("ibtn", subtitles && visible && "is-active")}
        aria-label="Subtitles"
        aria-expanded={pop.open}
        onClick={() => pop.setOpen((o) => !o)}
      >
        <Captions />
      </button>
      {pop.open && (
        <div className="pop__panel menu">
          <p className="menu__title">Subtitles</p>
          {subtitles ? (
            <>
              <label className="switch switch--compact">
                <span className="switch__label">Show “{subtitles.label}”</span>
                <input type="checkbox" checked={visible} onChange={(e) => session.setPrefs({ subtitlesVisible: e.target.checked })} />
              </label>
              <button type="button" className="menu__item" onClick={() => session.clearSubtitles()}>
                Remove subtitles
              </button>
            </>
          ) : (
            <p className="menu__hint">Load an .srt or .vtt file. Like the movie, it stays on your device.</p>
          )}
          <button type="button" className="menu__item" onClick={() => input.current?.click()}>
            Load subtitle file…
          </button>
          <input
            ref={input}
            type="file"
            accept=".srt,.vtt,text/vtt"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void session.loadSubtitles(file);
              e.target.value = "";
              pop.setOpen(false);
            }}
          />
          <p className="menu__hint">Subtitles embedded inside MKV files aren't readable by browsers.</p>
        </div>
      )}
    </div>
  );
}

function RateButton({ disabled }: { disabled: boolean }) {
  const session = useSession();
  const rate = useRoom((s) => s.room?.playback.rate ?? 1);
  const pop = usePopover();
  return (
    <div className="pop hide-sm" ref={pop.ref}>
      <button
        type="button"
        className="ibtn ratebtn tnum"
        disabled={disabled}
        aria-label={`Playback speed ${rate}×`}
        aria-expanded={pop.open}
        onClick={() => pop.setOpen((o) => !o)}
      >
        {rate}×
      </button>
      {pop.open && (
        <div className="pop__panel menu" role="menu" aria-label="Playback speed for everyone">
          {PLAYBACK_RATES.map((r) => (
            <button
              key={r}
              type="button"
              role="menuitemradio"
              aria-checked={r === rate}
              className={cx("menu__item", r === rate && "is-active")}
              onClick={() => {
                session.setRate(r);
                pop.setOpen(false);
              }}
            >
              {r === 1 ? "Normal" : `${r}×`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
