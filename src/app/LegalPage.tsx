import { useEffect } from "react";
import { LIMITS } from "../../shared/constants";
import { AppShell } from "./AppShell";

/** Plain-language policies that match what the code actually does. */
export default function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  useEffect(() => {
    document.title = `${kind === "privacy" ? "Privacy" : "Terms"} — STARBYTE`;
  }, [kind]);

  return (
    <AppShell>
      <article className="legal">
        {kind === "privacy" ? <Privacy /> : <Terms />}
      </article>
    </AppShell>
  );
}

function Privacy() {
  return (
    <>
      <p className="eyebrow">✦ Policies</p>
      <h1 className="page-title pixel">Privacy</h1>
      <p className="legal__lede">
        STARBYTE synchronizes playback. It does not need your movie, and in Local Mode it never receives it.
      </p>

      <h2>What never leaves your device</h2>
      <ul>
        <li>The media file you select. It is played by your browser from your disk.</li>
        <li>Subtitle files you load. They are converted and attached locally.</li>
        <li>Your screen. STARBYTE never captures or shares it.</li>
        <li>
          Your camera and microphone, unless you join the call — and even then they go straight to the other people
          in the room, never through STARBYTE.
        </li>
      </ul>

      <h2>The voice and video call</h2>
      <p>
        Joining the call is always a deliberate tap, and your browser asks permission first. The call is peer to
        peer: your audio and video travel directly to the other people in the room. The server's only job is to
        pass along the connection setup messages so two browsers can find each other.
      </p>
      <p>
        Because it is peer to peer, the people you are on a call with can see your IP address — that is how a
        direct connection works, and it is the same for you and for them. There is no relay server in the middle,
        which is also why a call sometimes cannot connect on a restrictive network. Nothing is recorded, by anyone.
        Leaving the call stops your camera and microphone immediately.
      </p>

      <h2>Shared links</h2>
      <p>
        A room can watch one shared link — a Google Drive file or a direct video URL — instead of everyone opening
        their own copy. The server stores the link and the name shown for it. It never opens, fetches or stores
        what the link points to: every browser loads it straight from the source, so the video still never passes
        through STARBYTE. Anyone in the room can see the link.
      </p>

      <h2>What the room server sees</h2>
      <ul>
        <li>The display name you choose and a random participant id.</li>
        <li>Playback actions: play, pause, seek and speed changes, with timestamps.</li>
        <li>Chat messages, reactions and saved moments in the room.</li>
        <li>
          Your file's name, size, duration, detected codecs and a fingerprint (a hash of three 1 MiB samples, or of
          the whole file if you choose "verify"). This is used only to check that everyone has the same media.
        </li>
        <li>
          Room creation is rate limited using a salted hash of your IP address. The raw address is not stored.
        </li>
        <li>
          Whether you are in the call, and whether your microphone is muted and camera on — so the room can show
          it. Never the audio or video itself.
        </li>
      </ul>

      <h2>Visit counter</h2>
      <p>
        The site keeps two numbers: visits today and visits all time. One visit is counted per browser session, so
        reloading or moving between pages doesn't add to it. To stop the counter being inflated, the same salted IP
        hash used for rate limiting caps how much a single network can add in a day. No cookie, no profile and no
        record of which pages you looked at.
      </p>

      <h2>How long it is kept</h2>
      <p>
        A room keeps its last {LIMITS.chatHistory} chat messages and its moments while it is in use. Once nobody has
        been connected for 24 hours, the room and everything in it is deleted.
      </p>

      <h2>Accounts, cookies and tracking</h2>
      <p>
        There are no accounts and no advertising or analytics trackers. Your name, preferences and room keys are
        stored in your own browser's local storage so you don't have to retype them.
      </p>
    </>
  );
}

function Terms() {
  return (
    <>
      <p className="eyebrow">✦ Policies</p>
      <h1 className="page-title pixel">Terms</h1>
      <p className="legal__lede">The short version: bring media you're allowed to watch, and be kind in rooms.</p>

      <h2>Your media, your responsibility</h2>
      <p>
        STARBYTE never hosts, stores or distributes media. Each viewer supplies their own copy. Only use files and
        sources you have the right to watch. STARBYTE does not bypass DRM, paywalls or access controls, and must not
        be used to try.
      </p>

      <h2>Rooms</h2>
      <p>
        Rooms are private to whoever has the link. Hosts can change room settings and decide who controls playback.
        Rooms hold up to {LIMITS.maxParticipants} people and expire a day after everyone leaves.
      </p>

      <h2>Fair use of a free service</h2>
      <p>
        STARBYTE runs within free infrastructure limits. Room creation and messages are rate limited, and the service
        may be unavailable when daily capacity is reached. It is provided as-is, without warranties.
      </p>
    </>
  );
}
