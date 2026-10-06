import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { useEffect, useRef } from "react";
import { Avatar } from "../art/Avatar";
import { cx } from "../lib/cx";
import { CALL_SIZE_MAX, CALL_SIZE_MIN } from "./prefs";
import { PixelButton } from "../ui/PixelButton";
import { useRoom, useSession } from "./context";

/**
 * The call rides on the presence bubbles rather than adding a second row of the same faces:
 * a bubble shows a camera if that person has one on, their pixel avatar if not, and rings
 * while they are talking. No meeting grid — the movie stays the thing you are looking at.
 */
export function CallFace({
  seed,
  stream,
  video,
  size,
  self,
}: {
  seed: number;
  stream: MediaStream | null;
  video: boolean;
  size: number;
  self?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream, video]);

  if (!video || !stream) return <Avatar seed={seed} size={size} tone="idle" />;
  return (
    // Muted either way: a remote stream is heard through the call's own audio sink, and our
    // own microphone played back would be an echo.
    <video
      ref={ref}
      className={cx("cface", self && "cface--self")}
      style={{ width: size, height: size }}
      autoPlay
      playsInline
      muted
    />
  );
}

/**
 * The call's front door, in the People tab. The control bar has the same thing as icons, but
 * that bar fades out on its own — someone looking for "where is the video call" needs a place
 * that stays put and says so in words.
 */
export function CallPanel() {
  const session = useSession();
  const call = useRoom((s) => s.call);
  const videoDefault = useRoom((s) => s.prefs.callVideoDefault);
  // Select stable references only — a selector that builds a new array every call never
  // settles under useSyncExternalStore and spins the render loop.
  const participants = useRoom((s) => s.room?.participants);
  const me = useRoom((s) => s.me);
  const others = (participants ?? []).filter((p) => p.online && p.call?.on && p.id !== me);

  if (!call.joined) {
    return (
      <div className="callpanel">
        <div className="callpanel__head">
          <Phone size={15} aria-hidden="true" />
          <h3>Voice &amp; video</h3>
        </div>
        <p className="callpanel__lead">
          {others.length > 0
            ? `${others.map((p) => p.name).join(", ")} ${others.length === 1 ? "is" : "are"} on the call.`
            : "Talk over the movie. Your camera and mic go straight to the others, never through STARBYTE."}
        </p>
        {call.error && <p className="callpanel__error">{call.error}</p>}
        <div className="callpanel__actions">
          <PixelButton size="sm" onClick={() => void session.joinCall(videoDefault)} disabled={call.joining}>
            {call.joining ? "Asking…" : others.length > 0 ? "Join the call" : "Start a call"}
          </PixelButton>
          {!call.joining && (
            <button type="button" className="link-btn" onClick={() => void session.joinCall(!videoDefault)}>
              {videoDefault ? "Join with voice only" : "Join with camera"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const failed = call.peers.filter((p) => p.status === "failed").length;
  return (
    <div className="callpanel callpanel--live">
      <div className="callpanel__head">
        <Phone size={15} aria-hidden="true" />
        <h3>
          In the call · {call.peers.length + 1} {call.peers.length + 1 === 1 ? "person" : "people"}
        </h3>
      </div>
      {failed > 0 && (
        <p className="callpanel__error">
          Couldn't reach {failed === 1 ? "someone" : `${failed} people`} directly. Calls are peer to peer, so a
          strict network can block them — the movie keeps playing either way.
        </p>
      )}
      <div className="callpanel__actions">
        <button
          type="button"
          className={cx("ibtn callbtn", call.muted && "is-off")}
          onClick={() => session.setCallMuted(!call.muted)}
          aria-pressed={call.muted}
          aria-label={call.muted ? "Unmute your microphone" : "Mute your microphone"}
        >
          {call.muted ? <MicOff /> : <Mic />}
        </button>
        <button
          type="button"
          className={cx("ibtn callbtn", !call.video && "is-off")}
          onClick={() => void session.setCallVideo(!call.video)}
          aria-pressed={call.video}
          aria-label={call.video ? "Turn your camera off" : "Turn your camera on"}
        >
          {call.video ? <Video /> : <VideoOff />}
        </button>
        <PixelButton size="sm" variant="ghost" onClick={() => session.leaveCall()}>
          Leave call
        </PixelButton>
      </div>
      <CallSizeControl />
    </div>
  );
}

/**
 * How big the faces are drawn. It lives next to the call controls rather than buried in
 * settings, because the moment you notice the faces are too small is the moment you are
 * looking at this panel. Personal, like volume — it changes nothing for anyone else.
 */
export function CallSizeControl() {
  const session = useSession();
  const size = useRoom((s) => s.prefs.callSize);
  return (
    <label className="callsize">
      <span className="callsize__label">Face size</span>
      <input
        type="range"
        className="range"
        min={CALL_SIZE_MIN}
        max={CALL_SIZE_MAX}
        step={4}
        value={size}
        onChange={(e) => session.setPrefs({ callSize: Number(e.target.value) })}
        aria-label="Size of the faces in the call"
      />
      <span className="callsize__value tnum">{size}px</span>
    </label>
  );
}

/** Join / mute / camera / hang up, in the control bar beside the movie controls. */
export function CallControls() {
  const session = useSession();
  const call = useRoom((s) => s.call);
  const videoDefault = useRoom((s) => s.prefs.callVideoDefault);
  const inCall = useRoom((s) => (s.room?.participants ?? []).filter((p) => p.online && p.call?.on).length);

  if (!call.joined) {
    return (
      <button
        type="button"
        className="ibtn callbtn"
        onClick={() => void session.joinCall(videoDefault)}
        disabled={call.joining}
        aria-label={call.joining ? "Asking for microphone access" : "Join the voice call"}
        title={call.joining ? "Asking for microphone access…" : "Join the call"}
      >
        <Mic />
        {inCall > 0 && <span className="dot-count">{inCall}</span>}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className={cx("ibtn callbtn", call.muted && "is-off")}
        onClick={() => session.setCallMuted(!call.muted)}
        aria-pressed={call.muted}
        aria-label={call.muted ? "Unmute your microphone" : "Mute your microphone"}
        title={call.muted ? "Unmute" : "Mute"}
      >
        {call.muted ? <MicOff /> : <Mic />}
      </button>
      <button
        type="button"
        className={cx("ibtn callbtn", !call.video && "is-off")}
        onClick={() => void session.setCallVideo(!call.video)}
        aria-pressed={call.video}
        aria-label={call.video ? "Turn your camera off" : "Turn your camera on"}
        title={call.video ? "Camera off" : "Camera on"}
      >
        {call.video ? <Video /> : <VideoOff />}
      </button>
      <button
        type="button"
        className="ibtn callbtn callbtn--leave"
        onClick={() => session.leaveCall()}
        aria-label="Leave the call"
        title="Leave the call"
      >
        <PhoneOff />
      </button>
    </>
  );
}
