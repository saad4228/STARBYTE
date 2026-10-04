import { ArrowRight, FileVideo, Link2, Lock, ShieldCheck, Users } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { formatBytes, formatDelta, formatTime } from "../../shared/format";
import { compareMedia } from "../../shared/media";
import { Avatar } from "../art/Avatar";
import { Pixel } from "../art/Pixel";
import { icons } from "../art/sprites";
import { Notice } from "../app/AppShell";
import { cx } from "../lib/cx";
import { MEDIA_ACCEPT } from "../media/analyze";
import { Badge, Chip } from "../ui/Badge";
import { PixelButton } from "../ui/PixelButton";
import { useRoom, useSession } from "./context";
import { StepIcon } from "./parts";

interface MediaPanelProps {
  /** Shown when the media is ready ("Enter cinema"). Omit inside the room. */
  onEnter?: () => void;
  enterLabel?: string;
}

/**
 * Bring your media: drop a file → ANALYZING MEDIA… → MEDIA CHECK.
 * Used in the lobby and in the room's "change file" dialog.
 */
export function MediaPanel({ onEnter, enterLabel = "Enter cinema" }: MediaPanelProps) {
  const session = useSession();
  const analysis = useRoom((s) => s.analysis);
  const media = useRoom((s) => s.media);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = () => input.current?.click();
  const take = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file) void session.selectFile(file);
  };
  const dragProps = {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      take(e.dataTransfer.files);
    },
  };

  const busy = analysis && !analysis.done;
  // A shared link has no local file to analyse: it either opens here or it does not.
  if (analysis && !analysis.file) {
    return (
      <section className="frame mediapanel" aria-labelledby="media-title">
        <LoadingSource />
      </section>
    );
  }
  return (
    <section className={cx("frame mediapanel", dragging && "is-dragging")} aria-labelledby="media-title" {...dragProps}>
      <input
        ref={input}
        type="file"
        accept={MEDIA_ACCEPT}
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
      {busy ? (
        <Analyzing onRetry={pick} />
      ) : media ? (
        <MediaCheck onEnter={onEnter} enterLabel={enterLabel} onChange={pick} />
      ) : (
        <Dropzone onPick={pick} />
      )}
    </section>
  );
}

function Dropzone({ onPick }: { onPick: () => void }) {
  const session = useSession();
  const roomMedia = useRoom((s) => s.room?.media ?? null);
  const room = useRoom((s) => s.room);
  const control = room ? session.canControl() : false;

  let title = "Media required";
  let lead: string;
  if (roomMedia) lead = `Pick your copy of ${roomMedia.name}.`;
  else if (control || !room) {
    title = "Pick tonight's movie";
    lead = "Choose the file everyone will watch. Friends bring their own copy.";
  } else {
    title = "Waiting for the host's pick";
    lead = "You can choose your copy now — we'll check it the moment the host picks.";
  }

  return (
    <div className="mp">
      <h2 id="media-title" className="mp__title pixel">
        {title}
      </h2>
      <p className="mp__lead">{lead}</p>
      {roomMedia && (
        <div className="mp__target">
          <FileVideo size={18} aria-hidden="true" />
          <span className="mp__target-name">{roomMedia.name}</span>
          <span className="mp__target-meta tnum">
            {formatTime(roomMedia.duration, true)} · {formatBytes(roomMedia.size)}
          </span>
        </div>
      )}
      <div className="drop">
        <Pixel sprite={icons.local} scale={5} />
        <p className="drop__title">Drop your movie here</p>
        <PixelButton onClick={onPick}>Select file</PixelButton>
        <p className="drop__formats">MP4 · WEBM · MKV · MOV — whatever this browser can play</p>
      </div>
      <ul className="mp__facts">
        <li>
          <Lock size={15} aria-hidden="true" /> Your movie stays on your device. STARBYTE only synchronizes playback.
        </li>
        <li>
          <Users size={15} aria-hidden="true" /> Everyone in the room needs their own copy of the file.
        </li>
      </ul>
      {control || !room ? (
        <SourceForm />
      ) : (
        <div className="mp__other">
          <span>Other sources</span>
          <span className="mp__src">
            <Pixel sprite={icons.cloud} scale={2} /> Drive
          </span>
          <span className="mp__src">
            <Pixel sprite={icons.stream} scale={2} /> Link
          </span>
          <span className="mp__srcnote">Whoever controls the room can put one up for everyone.</span>
        </div>
      )}
    </div>
  );
}

/**
 * The other way in: one link everybody opens, instead of everybody finding their own copy.
 * A Drive share link and a direct video URL both arrive here — resolveSource tells them apart.
 */
function SourceForm() {
  const session = useSession();
  const check = useRoom((s) => s.sourceCheck);
  const [value, setValue] = useState("");
  const busy = !!check?.busy;

  return (
    <form
      className="srcform"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && value.trim()) void session.setSource(value);
      }}
    >
      <div className="srcform__head">
        <Link2 size={15} aria-hidden="true" />
        <span>Or share one link with the room</span>
      </div>
      <div className="srcform__row">
        <input
          className="input"
          type="url"
          inputMode="url"
          placeholder="Google Drive link or direct video URL"
          aria-label="Google Drive link or direct video URL"
          value={value}
          disabled={busy}
          onChange={(e) => {
            setValue(e.target.value);
            if (check) session.dismissSourceCheck();
          }}
        />
        <PixelButton type="submit" disabled={busy || !value.trim()}>
          {busy ? "Checking…" : "Use link"}
        </PixelButton>
      </div>
      {busy && <p className="srcform__busy">Opening it here first, so a dead link never reaches the room…</p>}
      {check?.error && (
        <Notice tone="danger" title="That link didn't work">
          {check.error}
        </Notice>
      )}
      <p className="srcform__note">
        Everyone plays it straight from the source — it still never passes through STARBYTE. Drive files must be
        shared as “Anyone with the link”.
      </p>
    </form>
  );
}

/** Loading the room's shared link. There is no file to hash, so this is just a wait. */
function LoadingSource() {
  const session = useSession();
  const analysis = useRoom((s) => s.analysis);
  const source = useRoom((s) => s.room?.source ?? null);
  const control = useRoom((s) => (s.room ? session.canControl() : false));
  if (!analysis) return null;

  return (
    <div className="mp">
      <h2 id="media-title" className="mp__title pixel">
        {analysis.error ? "This link didn't open" : "Opening the room's link…"}
      </h2>
      <div className="mp__target">
        <Link2 size={18} aria-hidden="true" />
        <span className="mp__target-name">{source?.name ?? "Shared source"}</span>
        {source && <Chip tone={source.kind === "drive" ? "live" : "soon"}>{source.kind === "drive" ? "Drive" : "Link"}</Chip>}
      </div>
      {analysis.error ? (
        <>
          <Notice tone="danger" title="Couldn't play the shared link">
            {analysis.error}
          </Notice>
          {control && (
            <div className="mp__actions">
              <PixelButton variant="ghost" onClick={() => session.clearSource()}>
                Drop the link — go back to files
              </PixelButton>
            </div>
          )}
        </>
      ) : (
        <p className="mp__lead">Checking that it plays in this browser.</p>
      )}
    </div>
  );
}

function Analyzing({ onRetry }: { onRetry: () => void }) {
  const session = useSession();
  const analysis = useRoom((s) => s.analysis);
  const media = useRoom((s) => s.media);
  if (!analysis) return null;
  const steps = analysis.steps.length
    ? analysis.steps
    : [{ id: "file", label: "Filename", status: "pending" as const, value: analysis.file?.name ?? "" }];
  const firstPending = steps.findIndex((s) => s.status === "pending");

  return (
    <div className="mp">
      <h2 id="media-title" className="mp__title pixel">
        {analysis.error ? "Can't play this file" : "Analyzing media…"}
      </h2>
      <ul className="checks" aria-live="polite">
        {steps.map((s, i) => (
          <li key={s.id} className={cx("check", `check--${s.status}`)}>
            <span className="check__icon">
              <StepIcon status={s.status === "pending" && i === firstPending && !analysis.error ? "active" : s.status} />
            </span>
            <span className="check__label">{s.label}</span>
            <span className="check__value">{s.value}</span>
          </li>
        ))}
      </ul>
      {analysis.error && (
        <>
          <Notice tone="danger" title="This media format isn't supported">
            {analysis.error} Try another browser-supported format (MP4 with H.264/AAC works everywhere).
          </Notice>
          <div className="mp__actions">
            <PixelButton onClick={onRetry}>Choose another file</PixelButton>
            {media?.file && (
              <PixelButton variant="ghost" onClick={() => session.clearAnalysis()}>
                Keep {media.file.name}
              </PixelButton>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MediaCheck({ onEnter, enterLabel, onChange }: { onEnter?: () => void; enterLabel: string; onChange: () => void }) {
  const session = useSession();
  const media = useRoom((s) => s.media);
  const room = useRoom((s) => s.room);
  const me = useRoom((s) => s.me);
  const analysis = useRoom((s) => s.analysis);
  if (!media) return null;

  const sharedSource = !!media.source;
  const reference = room?.media ?? null;
  const cmp = reference ? compareMedia(reference, media.fingerprint) : null;
  const control = room ? session.canControl() : false;
  const connected = !!room && !!me;

  let verdict: { tone: "ok" | "warn" | "info"; title: string; body: string };
  if (sharedSource) {
    // One URL for the room, so there is nothing to compare — everyone has the same bytes.
    verdict = {
      tone: "ok",
      title: "Everyone's on the same link",
      body: "No copies to match: the whole room is playing this one source.",
    };
  } else if (!reference) {
    verdict = control
      ? { tone: "info", title: "Setting the room's movie…", body: "Your file becomes the reference everyone else is checked against." }
      : { tone: "info", title: "Waiting for the host's pick", body: "We'll compare your file as soon as the host chooses the movie." };
  } else if (cmp?.match === "identical") {
    verdict = {
      tone: "ok",
      title: "Media matched",
      body: cmp.sameFull ? "Whole-file hash is identical." : "Same size and the same sampled fingerprint.",
    };
  } else if (cmp?.match === "compatible") {
    verdict = {
      tone: "ok",
      title: "Compatible",
      body: "Durations match, but it's a different encode. It should line up — tiny offsets are possible.",
    };
  } else {
    verdict = {
      tone: "warn",
      title: "The files don't match",
      body: `Duration differs by ${formatDelta(cmp?.durationDelta ?? 0)}. Playback may drift because the files differ.`,
    };
  }

  const others = (room?.participants ?? []).filter((p) => p.online || p.media);
  const verifying = media.verifying;

  return (
    <div className="mp">
      <h2 id="media-title" className="mp__title pixel">
        Media check
      </h2>

      <div className="mine">
        <FileVideo size={20} aria-hidden="true" />
        <div className="mine__text">
          <p className="mine__name">{media.file?.name ?? media.source?.name ?? "Shared link"}</p>
          <p className="mine__meta tnum">
            {formatTime(media.fingerprint.duration, true)}
            {media.fingerprint.size > 0 && ` · ${formatBytes(media.fingerprint.size)}`}
            {media.fingerprint.videoCodec && ` · ${media.fingerprint.videoCodec}`}
            {media.fingerprint.audioCodecs?.[0] && ` · ${media.fingerprint.audioCodecs[0]}`}
          </p>
        </div>
        <button type="button" className="link-btn" onClick={onChange}>
          Change
        </button>
      </div>

      {(media.analysis?.warnings ?? []).map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}

      {others.length > 0 && (
        <ul className="matchlist" aria-label="Everyone's media">
          {others.map((p) => {
            const m = p.media && reference ? compareMedia(reference, p.media).match : null;
            const isRef = !!p.media && !!reference && p.media.sampleHash === reference.sampleHash && p.host;
            return (
              <li key={p.id}>
                <Avatar seed={p.avatar} size={28} tone={m === "mismatch" ? "danger" : p.media ? "ok" : "idle"} />
                <span className="matchlist__name">
                  {p.name}
                  {p.id === me && <em> (you)</em>}
                </span>
                <span className="matchlist__file">{p.media ? p.media.name : "choosing…"}</span>
                <span className="matchlist__dur tnum">{p.media ? formatTime(p.media.duration, true) : ""}</span>
                <span className="matchlist__state">
                  {!p.media ? (
                    <Badge tone="muted" ring>
                      Waiting
                    </Badge>
                  ) : !reference ? (
                    <Badge tone="muted">Loaded</Badge>
                  ) : m === "mismatch" ? (
                    <Badge tone="danger">Mismatch</Badge>
                  ) : isRef ? (
                    <Badge tone="ok">Reference</Badge>
                  ) : (
                    <Badge tone="ok">{m === "identical" ? "Identical" : "Compatible"}</Badge>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className={cx("verdict", `verdict--${verdict.tone}`)} role="status">
        <p className="verdict__title pixel">
          {verdict.tone === "ok" ? "✓ " : verdict.tone === "warn" ? "⚠ " : "◌ "}
          {verdict.title}
        </p>
        <p className="verdict__body">{verdict.body}</p>
      </div>

      <div className="mp__actions">
        {onEnter && (
          <PixelButton
            size="lg"
            variant={cmp?.match === "mismatch" ? "ghost" : "primary"}
            onClick={onEnter}
            disabled={!connected}
            iconEnd={<ArrowRight size={18} strokeWidth={2.5} />}
          >
            {!connected ? "Connecting…" : cmp?.match === "mismatch" ? "Enter anyway" : enterLabel}
          </PixelButton>
        )}
        {cmp?.match === "mismatch" && (
          <PixelButton variant="primary" onClick={onChange}>
            Choose another file
          </PixelButton>
        )}
        {cmp?.match === "mismatch" && control && (
          <PixelButton variant="ghost" onClick={() => session.adoptMedia()}>
            Use my file for everyone
          </PixelButton>
        )}
      </div>

      <div className="mp__verify">
        <ShieldCheck size={16} aria-hidden="true" />
        {media.fingerprint.fullHash ? (
          <span>Whole file verified · {media.fingerprint.fullHash.slice(0, 12)}</span>
        ) : verifying !== null ? (
          <span className="tnum">
            Verifying whole file… {Math.round(verifying * 100)}%
            <span className="mp__bar" aria-hidden="true">
              <i style={{ width: `${verifying * 100}%` }} />
            </span>
          </span>
        ) : (
          <>
            <span>Sampled fingerprint {media.fingerprint.sampleHash.slice(0, 12)}</span>
            <button type="button" className="link-btn" onClick={() => void session.verifyFile()}>
              Verify whole file
            </button>
          </>
        )}
      </div>

      {analysis?.steps.length ? (
        <details className="mp__details">
          <summary>Analysis details</summary>
          <ul className="checks checks--compact">
            {analysis.steps.map((s) => (
              <li key={s.id} className={cx("check", `check--${s.status}`)}>
                <span className="check__icon">
                  <StepIcon status={s.status} />
                </span>
                <span className="check__label">{s.label}</span>
                <span className="check__value">{s.value}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
