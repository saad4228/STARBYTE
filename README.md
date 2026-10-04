# STARBYTE — Watch Party

**Your screen. Their reactions.** A multiplayer media room: friends watch together in perfect sync
while every movie stays on its owner's device. STARBYTE doesn't own the movie — it owns the shared
experience.

- **Local-first.** In Local Mode the file never leaves your computer. Each viewer plays their own copy.
- **Synchronization-first.** The server synchronizes *state and time*, never media bytes.
- **Zero-cost by design.** Static assets + one Cloudflare Worker + one Durable Object per room, built to
  stay inside the Workers Free plan.

---

## Quick start

```bash
npm install
npm run dev          # Vite + the Worker + Durable Objects (workerd), one process
```

Open <http://localhost:5173>, create a room, then open the invite link in a **second window or another
browser** (a new tab works too — each tab is its own viewer). Pick the same video file in both and press
**I'm ready** in each.

> Needs Node 22+. The first `npm install` downloads `workerd`; approve its install script if npm asks.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR; the API and rooms run locally in workerd |
| `npm test` | Unit tests (protocol, room state machine, drift policy, clock, media sniffing) |
| `npm run build` | Type-check every project and build the client + Worker into `dist/` |
| `npm run preview` | Serve the production build locally through workerd |
| `npm run deploy` | Build and deploy to Cloudflare with Wrangler |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` |

---

## How it works

```
 Browser (each viewer)                                 Cloudflare
┌─────────────────────────────────────┐   WebSocket   ┌──────────────────────────────┐
│ <video> ← File (never uploaded)      │ ◀──────────▶ │ Worker  /api/*               │
│   ▲                                  │  tiny JSON    │   └─ Durable Object per room │
│ SyncEngine ── ServerClock (NTP-ish)  │  events only  │       RoomCore (pure logic)  │
│   ▲                                  │               │       SQLite storage, alarms │
│ RoomSession (state, prediction)      │               │ Gatekeeper DO (rate limits)  │
└─────────────────────────────────────┘               └──────────────────────────────┘
```

### The authoritative state

The room holds one playback state:

```ts
{ status: "playing" | "paused", position, anchor, rate, seq, started }
```

`position` is where the media is at server time `anchor`. While playing, the room position at any
moment is `position + (now − anchor) × rate`. A **future anchor** means "start from `position` at
exactly this moment" — that single idea gives us the 3·2·1 countdown, synchronized resumes and
"jump together" seeks without any extra messages.

### Time

Clients estimate the server clock with NTP-style pings (`offset = s − (c + rtt/2)`, keeping the
lowest-latency samples), re-measured every 3 minutes, on tab wake, and whenever the monotonic clock
drifts from wall time (laptop sleep).

### Drift correction

Every 200 ms the `SyncEngine` compares the local playhead with the extrapolated room position — no
network traffic involved:

| Drift | Action |
| --- | --- |
| < 40 ms | Nothing. Nobody can tell. |
| 40–500 ms | Gentle catch-up: proportional `playbackRate` nudge, capped at ±5% (pitch preserved) |
| ≥ 500 ms (configurable) | Jump: seek to the room position plus this device's learned seek latency |

It also learns each device's play-to-first-frame latency so scheduled starts land on time, backs
off if jumps repeat, and falls back to muted playback (with "tap to unmute") when a browser's
autoplay policy blocks sound — so nobody silently falls out of sync. Measured in the two-browser
end-to-end run: ~15–40 ms between viewers while playing; pause and seek land within a few ms.

### Protocol

Client → room: `hello`, `time`, `play`, `pause`, `seek`, `rate`, `start`, `ready`, `media`,
`adoptMedia`, `ended`, `chat`, `react`, `moment`, `status`, `settings`, `grant`, `leave`.
Room → client: `welcome`, `time`, `playback`, `participant`, `left`, `room`, `chat`, `react`,
`moment(s)`, `error`. Everything is validated server-side (`worker/validate.ts`); permissions,
timestamps and positions are never taken on trust. Your own actions are predicted locally and
reconciled with the room's answer, so controls feel instant.

### Media check

When you pick a file, the browser reads its metadata locally and a Web Worker computes a
fingerprint (SHA-256 over the size + three 1 MiB samples) and sniffs the container for codecs. Files
are compared by fingerprint and duration — **never by name**:

- **identical** — same size and sampled hash (or matching whole-file hash, via the optional *Verify
  whole file*)
- **compatible** — different encode, same duration (±2 s)
- **mismatch** — durations differ; the UI explains by how much

It also warns before movie night about codecs the browser can't decode (e.g. AC-3/DTS audio in MKV
files, which otherwise plays as picture without sound).

---

## Landing-page performance

The page is ~10,000px tall and animated throughout, so it follows four rules. Breaking any of them
cost 10–20 fps when measured:

1. **Never animate a property on a page-tall element.** The light trail's travelling glow is a small
   element on a CSS motion path (`offset-path` / `offset-distance`), not a `stroke-dashoffset`
   animation on the full-page SVG — that invalidated and re-rasterized the whole layer every frame.
2. **No SMIL.** `<animateMotion>` is not composited, redraws its whole SVG each frame, and keeps
   running off screen because `animation-play-state` does not apply to it. The connector packets use
   motion paths too.
3. **Pause what you cannot see.** `useOffscreenAnimationPause` pauses CSS animations in chapters
   outside the viewport (see `src/landing/parts.tsx`).
4. **Keep wide translucent strokes and full-viewport layers cheap.** The trail's stroke widths are
   deliberately modest, and the fixed starfield sits on its own compositor layer and drifts with a
   transform rather than `background-position`.

Measured on the production build (Chrome, 1440×900, median of 3): idle ~143 fps, and 99–132 fps while
scrolling at every speed from gentle to frantic. A live watch room with video playing holds ~142 fps,
including during a burst of reactions. Under `prefers-reduced-motion` the page runs zero animations
and reveals all content immediately.

Two things that look like easy wins but are not:

- **`content-visibility: auto` on the chapters.** Worth ~1.6× scroll fps, but it brings paint
  containment with it, which crops the art that deliberately bleeds past a chapter's edge — the ship,
  the flood lights, the final spill. A pixel diff put the damage at 2.9% of the page, so it stays off.
- **Stopping off-screen animations instead of pausing them.** `animation: none` in place of
  `animation-play-state: paused` measured no better (within noise). The pause already works: at any
  scroll position on a phone only 15–26 of ~110 animations are running, and 9–10 of 11 chapters are
  paused. The remaining cost is the animations actually on screen, which is the design.

On mobile, the room itself — the part that matters while watching — is the strong case: at 390×844
with the CPU throttled 4× it holds 6.9 ms UI frames (p95 7.2 ms) with **zero dropped video frames**
and 10–25 ms sync drift. The landing page is heavier; treat phone frame-rate figures taken on a busy
machine with suspicion, and measure CPU work per scroll (`Performance.getMetrics`) instead, which is
far less sensitive to what else is running.

## Project structure

```
shared/            Protocol types, limits, room ids, media comparison — used by both sides
worker/
  index.ts         API routes, origin checks, room creation
  room.ts          Durable Object adapter: hibernatable WebSockets, storage, alarms
  core.ts          RoomCore — the pure, unit-tested room state machine
  gatekeeper.ts    Global rate limiting for room creation
  stats.ts         Site visit counters (today / all time)
  validate.ts      Strict parsing of every client message
src/
  landing/         The landing page (12 sections, light trail, playable demo)
  art/             Pixel-art engine, sprites, procedural scenes, BYTE the mascot
  app/             Create / join / about / legal pages, API client, identity storage
  room/            RoomSession, connection, lobby, media panel, the watch room UI
  sync/            ServerClock, drift policy, SyncEngine
  media/           Source adapters (HTML5, YouTube), link resolving, analysis worker, subtitles
  call/            WebRTC mesh: peer connections, signalling, speaking detection
  ui/              Pixel buttons, badges, logo
```

Every media source implements one `MediaAdapter` interface (`src/media/adapter.ts`), so Drive,
stream URLs and official embeds can be added without touching the sync engine.

---

## Deploying (Cloudflare, free plan)

```bash
npx wrangler login
npm run deploy
```

That deploys the static site and the Worker together (Workers Static Assets — asset requests are free
and don't invoke the Worker). Durable Objects use the SQLite backend, which is what the Workers Free
plan supports.

Configuration lives in `wrangler.jsonc` → `vars`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAX_ROOMS_PER_DAY` | `2000` | Global daily cap on new rooms ("Free-tier capacity reached" after that) |
| `MAX_ROOMS_PER_IP_PER_HOUR` | `12` | Per-IP creation limit (IPs are only kept as salted hashes) |
| `ALLOWED_ORIGINS` | `""` | Extra comma-separated origins allowed to use the API from a browser |

Optional build-time variables. `VITE_GITHUB_URL` overrides the GitHub links and `VITE_CONTACT_EMAIL` adds an email link to the About page (there is no email by default). Put them in a `.env` file:

```
VITE_GITHUB_URL=https://github.com/your-handle
VITE_CONTACT_EMAIL=you@example.com
```

## On a phone

The room is built for portrait and landscape separately, and both are verified end to end (see the
`@media (max-width: 860px)` and the short-landscape block in `src/room/room.css`):

- **Touch has no hover**, so a tap on the picture toggles the controls, and double-tap-to-fullscreen
  is restricted to a mouse — on touch it collided with tapping twice to show and hide them.
- **Landscape** gives the picture the whole screen, with the top bar floating over it and fading out
  with the controls. The panel becomes an overlay drawer there, and cinema mode turns itself on so it
  starts out of the way. Hiding the bar outright left no way back to settings, invite or chat.
- **`viewport-fit=cover` is set**, so anything pinned to an edge pads itself with
  `env(safe-area-inset-*)` — otherwise the chat bar sits under the home indicator and the top bar
  under the notch.
- **Stacking matters more than it looks.** `.center` is a stacking context, so the ready sheet's
  `z-index` is relative to it, not the page; in landscape that put "Start now" under the seek bar.

## The About page

`/about` is linked from "Made by Mohammad Saad" in the footer. Everything personal on it lives in a
single `PROFILE` object at the top of `src/app/About.tsx` — name, tagline, the dialogue-box intro, the
character-sheet rows and the links. Links with an empty `href` are skipped, so the page stays tidy
while it is partly filled in. The portrait is `public/saad.webp` (with a `.jpg` fallback).

## Visit counters

The footer and the About page show visits today and visits all time, held by a `Stats` Durable
Object. One visit is counted per browser session, so refreshes and in-app navigation don't inflate
it; `today` rolls over at UTC midnight. Writes are coalesced to at most one per second however many
people arrive, and a salted IP hash caps how much one network can add in a day.

### Why it stays free

- **Hibernation.** Rooms use the WebSocket Hibernation API, so an idle room costs no duration while
  sockets stay open.
- **Heartbeats don't wake the room.** The runtime answers keep-alives itself (auto-response).
- **Quiet clients.** Clients report sync status only when it changes, and re-measure the clock every
  few minutes — not on every `timeupdate`.
- **Bounded everything.** 8 viewers per room, 8 KB frames, token-bucket rate limits per viewer, capped
  chat history and moments, rooms deleted 24 h after the last person leaves.
- **No media infrastructure.** No uploads, storage, CDN, proxying or paid APIs.

---

## Why duration is measured twice

A file's length is read once before playback, by a detached probe, and frozen into the
fingerprint. That figure is load-bearing: the room clamps every seek to it, and two copies are
judged the same film by comparing it. When it is wrong — browsers estimate it for some
containers and revise it later, and phone recordings can simply carry a false value — the room
becomes unusable in a way that looks like a sync bug: scrubbing past the bogus length snaps back,
the status sits on "catching up" forever, and matching copies report a mismatch.

So the player that is actually running gets the last word. `reconcileDuration` compares the live
element against the fingerprint on every sync tick, and a disagreement over half a second
rewrites the fingerprint and tells the room. The server takes the correction for the same file
rather than treating it as a different one (`sameFile` deliberately ignores duration), which is
also why re-measuring never resets anyone's ready state.

## Privacy model

In Local Mode the room server sees: display names, random participant ids, playback actions, chat,
reactions, moments, and each file's name/size/duration/codecs/fingerprint (to check everyone has the
same media). It never receives the media, the screen, or an account — there are no accounts.

Two things were added on top of that, and neither changes it:

- **Shared sources.** The room stores one https URL and the name shown for it. The server never
  fetches, proxies or inspects what is behind it — every browser loads it directly, so the bytes still
  never pass through STARBYTE. The URL is visible to everyone in the room, which is the point of it.
- **The call.** The server relays WebRTC offers, answers and ICE candidates and nothing else: the
  payloads are opaque strings, never parsed or stored, delivered only to the one participant they are
  addressed to. Audio and video go browser to browser. Because there is no TURN relay, peers do learn
  each other's IP addresses — that is inherent to peer-to-peer, and the privacy page says so.

See `src/app/LegalPage.tsx` for the user-facing version.

---

## Testing

```bash
npm test
```

Unit tests cover the room state machine (permissions, countdowns, auto-start, reconnect, host
handover, rate limits), message validation, the drift policy (including a convergence simulation),
clock estimation, MP4/Matroska codec sniffing and SRT→WebVTT conversion.

The full flow — two browsers creating, matching media, ready check, synced playback, pause/seek,
forced reconnect, chat, reactions and moments — was verified end to end with Playwright against
`npm run dev` and `npm run preview`. The dev server exposes `window.__starbyte` (the room session) to
make such scripts easy; it is stripped from production builds.

---

## Keyboard

`Space`/`K` play/pause · `←`/`→` ±10 s · `1`–`7` react · `S` mark a moment · `C` cinema mode ·
`/` chat · `M` mute · `F` fullscreen · `?` all shortcuts.

---

## Roadmap

- **V1 (this build):** landing page, create/join, local files, media check, synced play/pause/seek/rate,
  drift correction, ready check + countdown, reconnect, chat, presence, reactions, moments, cinema mode,
  local subtitles, settings.
- **V1.5 (shipped):** WebRTC voice/video as floating bubbles; the watch party keeps working when a
  call can't connect.
- **V2 (shipped):** Google Drive, direct stream URLs, and YouTube through the official IFrame
  player (`src/media/youtube.ts`) — each a `MediaAdapter`, so the sync engine never learns where
  the picture came from.
- **V3:** Live mode (live edge instead of a timeline, "sync to live room"), sports UI, deeper telemetry.

A render error or a lazily-imported chunk that 404s (a deploy landing while someone has the page
open) is caught by the error boundary in `src/app/ErrorBoundary.tsx`, which tells the two apart —
the stale-chunk case is cured by reloading and says so. The last line of defence against a blank
page.

## Known limitations

- Playback is limited to what each browser can decode. MP4 with H.264 + AAC works everywhere.
- Browsers only play a file's first audio track and can't read subtitles embedded in MKV files —
  load an `.srt`/`.vtt` instead.
- **No TURN relay.** Calls are peer-to-peer over public STUN only. A relay would cost money and
  would carry every call's audio and video, which is the thing this project refuses to do with the
  movie. Symmetric NAT and some corporate firewalls will not connect; the bubble says "Call didn't
  connect" and the watch party carries on regardless.
- **The call is a mesh**, so it is capped at `LIMITS.maxCallers` (6). Beyond that a selective
  forwarding unit would be needed — a server in the media path, which is the same trade refused above.
- **Google Drive throttles direct playback.** Large files get an interstitial scan page instead of
  the video, and Drive enforces its own daily bandwidth quota per file. The host sees this as a
  failed check before the link ever reaches the room, not as a broken room.
- **HLS (.m3u8) only plays where the browser plays it natively** — Safari and iOS. Chrome and Firefox
  need a direct MP4/WebM. DASH is not supported at all.
- **YouTube is their player, not ours.** Videos whose owners disable embedding (most music videos
  and films) cannot be used, and the check says so before the link reaches the room. Ads, age gates
  and regional blocks are YouTube's. Its clock is coarse and its speed control is a fixed menu, so
  the adapter declares `precision: "coarse"` and the engine corrects by seeking rather than by
  nudging the rate.
- **A 16:9 picture on an upright phone is capped by the screen's width** — about 220px tall on a
  390px-wide phone, whatever the layout does. Fullscreen asks the phone to rotate (where the
  browser allows it), which is the only thing that actually makes the picture bigger.
