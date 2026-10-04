import { LogOut, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LIMITS } from "../../shared/constants";
import { formatBytes, formatTime } from "../../shared/format";
import { formatRoomId } from "../../shared/ids";
import type { AutoStart, ControlMode } from "../../shared/protocol";
import { PixelButton } from "../ui/PixelButton";
import { useRoom, useSession } from "./context";
import { InviteCard } from "./Lobby";
import { MediaPanel } from "./MediaPanel";

/** Native <dialog>: focus trapping, Escape and the top layer for free. */
function Dialog({
  open,
  onClose,
  className,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className: string;
  labelledBy: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}

function Switch({
  label,
  desc,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="switch" htmlFor={id}>
      <span className="switch__text">
        <span className="switch__label">{label}</span>
        {desc && <span className="switch__desc">{desc}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="setting">
      <span className="setting__label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const session = useSession();
  const open = useRoom((s) => s.ui.dialog === "settings");
  return (
    <Dialog open={open} onClose={() => session.openDialog(null)} className="sheet" labelledBy="settings-title">
      <SettingsBody />
    </Dialog>
  );
}

function SettingsBody() {
  const session = useSession();
  const room = useRoom((s) => s.room);
  const me = useRoom((s) => s.me);
  const roomId = useRoom((s) => s.roomId);
  const prefs = useRoom((s) => s.prefs);
  const media = useRoom((s) => s.media);
  const [name, setName] = useState(room?.name ?? "");
  const subtitleInput = useRef<HTMLInputElement>(null);
  if (!room) return null;

  const host = !!room.participants.find((p) => p.id === me)?.host;
  const settings = room.settings;
  const saveName = (e?: FormEvent) => {
    e?.preventDefault();
    if (name.trim() && name.trim() !== room.name) session.updateRoom({ name });
  };
  const drift = prefs.drift;

  return (
    <div className="sheet__inner">
      <header className="sheet__head">
        <h2 id="settings-title" className="pixel">
          Settings
        </h2>
        <button type="button" className="ibtn" onClick={() => session.openDialog(null)} aria-label="Close settings">
          <X />
        </button>
      </header>

      <div className="sheet__body">
        <section className="sheet__section">
          <h3>Room</h3>
          {host ? (
            <form className="field" onSubmit={saveName}>
              <label className="field__label" htmlFor="set-room-name">
                Room name
              </label>
              <input
                id="set-room-name"
                className="input"
                value={name}
                maxLength={LIMITS.roomNameMax}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => saveName()}
              />
            </form>
          ) : (
            <p className="kv">
              <span>Name</span>
              <b>{room.name}</b>
            </p>
          )}
          <p className="kv">
            <span>Code</span>
            <b className="tnum">{formatRoomId(roomId)}</b>
          </p>
          <InviteCard roomId={roomId} />
          <Segmented<ControlMode>
            label="Who can control playback"
            value={settings.control}
            disabled={!host}
            options={[
              ["everyone", "Everyone"],
              ["host", "Host only"],
            ]}
            onChange={(control) => session.updateRoom({ settings: { control } })}
          />
          <p className="setting__hint">Rooms and their chat are deleted after 24 hours with nobody inside.</p>
        </section>

        <section className="sheet__section">
          <h3>Playback</h3>
          <Segmented<AutoStart>
            label="Start automatically when"
            value={settings.autoStart}
            disabled={!host}
            options={[
              ["all", "All ready"],
              ["most", "Most ready"],
              ["off", "Manual"],
            ]}
            onChange={(autoStart) => session.updateRoom({ settings: { autoStart } })}
          />
          <Switch
            label="Pause when someone drops out"
            desc="If a viewer disconnects without leaving, pause the room so nobody misses anything."
            checked={settings.pauseOnDisconnect}
            disabled={!host}
            onChange={(pauseOnDisconnect) => session.updateRoom({ settings: { pauseOnDisconnect } })}
          />
          <Switch
            label="3 · 2 · 1 countdown"
            desc="Count down before the first start so slow devices are ready."
            checked={settings.countdown}
            disabled={!host}
            onChange={(countdown) => session.updateRoom({ settings: { countdown } })}
          />
          {!host && <p className="setting__hint">Only the host can change room settings.</p>}
        </section>

        <section className="sheet__section">
          <h3>
            Sync <small>this device</small>
          </h3>
          <Switch
            label="Automatic drift correction"
            desc="Keep this screen on the room's timeline."
            checked={drift.enabled}
            onChange={(enabled) => session.setPrefs({ drift: { ...drift, enabled } })}
          />
          <Switch
            label="Gentle catch-up"
            desc="Fix small drift by playing up to 5% faster or slower instead of jumping."
            checked={drift.gentle}
            disabled={!drift.enabled}
            onChange={(gentle) => session.setPrefs({ drift: { ...drift, gentle } })}
          />
          <div className="setting setting--stack">
            <label className="setting__label" htmlFor="set-hard">
              Jump to the room when off by more than <b className="tnum">{drift.hardMs} ms</b>
            </label>
            <input
              id="set-hard"
              className="range"
              type="range"
              min={250}
              max={2000}
              step={50}
              value={drift.hardMs}
              disabled={!drift.enabled}
              onChange={(e) => session.setPrefs({ drift: { ...drift, hardMs: Number(e.target.value) } })}
            />
          </div>
        </section>

        <section className="sheet__section">
          <h3>Media</h3>
          {media ? (
            <dl className="kv-list">
              <div>
                <dt>{media.source ? "Link" : "File"}</dt>
                <dd>{media.file?.name ?? media.source?.name ?? "Shared link"}</dd>
              </div>
              <div>
                <dt>Length</dt>
                <dd className="tnum">{formatTime(media.fingerprint.duration, true)}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd className="tnum">{formatBytes(media.fingerprint.size)}</dd>
              </div>
              <div>
                <dt>Video</dt>
                <dd>
                  {media.fingerprint.videoCodec ?? "—"}
                  {media.fingerprint.width ? ` · ${media.fingerprint.width}×${media.fingerprint.height}` : ""}
                </dd>
              </div>
              <div>
                <dt>Audio</dt>
                <dd>{media.fingerprint.audioCodecs?.join(", ") ?? "—"}</dd>
              </div>
              <div>
                <dt>Fingerprint</dt>
                <dd className="tnum">{(media.fingerprint.fullHash ?? media.fingerprint.sampleHash).slice(0, 16)}</dd>
              </div>
            </dl>
          ) : (
            <p className="setting__hint">No file loaded.</p>
          )}
          <div className="sheet__row">
            <PixelButton variant="ghost" size="sm" onClick={() => session.openDialog("media")}>
              Change file…
            </PixelButton>
            <PixelButton variant="ghost" size="sm" onClick={() => subtitleInput.current?.click()} disabled={!media}>
              {media?.subtitles ? "Replace subtitles…" : "Load subtitles…"}
            </PixelButton>
            <input
              ref={subtitleInput}
              type="file"
              accept=".srt,.vtt,text/vtt"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void session.loadSubtitles(file);
                e.target.value = "";
              }}
            />
          </div>
          {media?.subtitles && (
            <Switch
              label={`Show subtitles (${media.subtitles.label})`}
              checked={prefs.subtitlesVisible}
              onChange={(subtitlesVisible) => session.setPrefs({ subtitlesVisible })}
            />
          )}
          <p className="setting__hint">Browsers play a file's first audio track; switching tracks isn't available on the web.</p>
        </section>

        <section className="sheet__section">
          <h3>Social</h3>
          <Switch
            label="Chat over the movie in cinema mode"
            desc="New messages appear briefly at the bottom of the screen."
            checked={prefs.chatOverlay}
            onChange={(chatOverlay) => session.setPrefs({ chatOverlay })}
          />
          <Switch
            label="Show other people's reactions"
            checked={prefs.showReactions}
            onChange={(showReactions) => session.setPrefs({ showReactions })}
          />
        </section>

        <section className="sheet__section">
          <h3>Call</h3>
          <Switch
            label="Quieten the movie while someone talks"
            desc="The soundtrack drops to a third, then comes straight back."
            checked={prefs.duckOnTalk}
            onChange={(duckOnTalk) => session.setPrefs({ duckOnTalk })}
          />
          <Switch
            label="Join with my camera on"
            desc="Off by default — joining is voice only until you turn the camera on."
            checked={prefs.callVideoDefault}
            onChange={(callVideoDefault) => session.setPrefs({ callVideoDefault })}
          />
          <p className="sheet__note">
            Audio and video go straight between browsers, never through STARBYTE. That also means a strict network
            can stop a call connecting, and the call holds up to {LIMITS.maxCallers} people.
          </p>
        </section>

        <section className="sheet__section">
          <h3>Notifications</h3>
          <Switch
            label="People joining and leaving"
            checked={prefs.notify.presence}
            onChange={(presence) => session.setPrefs({ notify: { ...prefs.notify, presence } })}
          />
          <Switch
            label="Play, pause and seek by others"
            checked={prefs.notify.playback}
            onChange={(playback) => session.setPrefs({ notify: { ...prefs.notify, playback } })}
          />
          <Switch
            label="Big sync corrections"
            checked={prefs.notify.sync}
            onChange={(sync) => session.setPrefs({ notify: { ...prefs.notify, sync } })}
          />
          <Switch
            label="Connection problems"
            checked={prefs.notify.connection}
            onChange={(connection) => session.setPrefs({ notify: { ...prefs.notify, connection } })}
          />
        </section>
      </div>

      <footer className="sheet__foot">
        <PixelButton variant="danger" icon={<LogOut size={16} />} onClick={() => session.leave()}>
          Leave room
        </PixelButton>
      </footer>
    </div>
  );
}

export function MediaDialog() {
  const session = useSession();
  const open = useRoom((s) => s.ui.dialog === "media");
  return (
    <Dialog open={open} onClose={() => session.openDialog(null)} className="modal" labelledBy="media-title">
      <div className="modal__inner">
        <button type="button" className="ibtn modal__close" onClick={() => session.openDialog(null)} aria-label="Close">
          <X />
        </button>
        <MediaPanel />
      </div>
    </Dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Space / K", "Play or pause for everyone"],
  ["← / J", "Back 10 seconds"],
  ["→ / L", "Forward 10 seconds"],
  ["1 – 7", "React 😂 😭 😱 ❤️ 🔥 💀 👏"],
  ["S", "Mark a moment"],
  ["C", "Toggle cinema mode"],
  ["/", "Jump to chat"],
  ["M", "Mute"],
  ["F", "Fullscreen"],
  ["?", "This list"],
];

export function HelpDialog() {
  const session = useSession();
  const open = useRoom((s) => s.ui.dialog === "help");
  return (
    <Dialog open={open} onClose={() => session.openDialog(null)} className="modal modal--small" labelledBy="help-title">
      <div className="modal__inner">
        <button type="button" className="ibtn modal__close" onClick={() => session.openDialog(null)} aria-label="Close">
          <X />
        </button>
        <h2 id="help-title" className="pixel modal__title">
          Controls
        </h2>
        <dl className="shortcuts">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys}>
              <dt>
                {keys.split(" / ").map((k, i) => (
                  <span key={k}>
                    {i > 0 && " "}
                    <kbd>{k}</kbd>
                  </span>
                ))}
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Dialog>
  );
}
