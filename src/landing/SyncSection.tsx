import { useState } from "react";
import { formatPrecise } from "../../shared/format";
import { Avatar } from "../art/Avatar";
import { cx } from "../lib/cx";
import { prefersReducedMotion } from "../lib/router";
import { Badge } from "../ui/Badge";
import { DEMO_PEOPLE } from "./demo";
import { SectionHead, TrailAnchor, useInView, useTicker } from "./parts";

type Mode = "synced" | "nudge" | "jump" | "jumped";
interface Lane {
  drift: number;
  mode: Mode;
  rate: number;
}

const LOOP = 12;

/**
 * A scripted replay of the real drift policy: ALI is 340 ms behind and catches up by
 * playing slightly faster; AHMED is 920 ms ahead and jumps straight back to the room.
 */
function lanesAt(t: number): Lane[] {
  const jitter = (seed: number) => Math.round(Math.sin(t * 2.3 + seed * 1.7) * 5);
  const saad: Lane = { drift: 5 + jitter(1), mode: "synced", rate: 1 };

  let ali: Lane;
  if (t < 0.8) ali = { drift: -340, mode: "nudge", rate: 1.05 };
  else {
    const d = -340 * Math.exp(-(t - 0.8) / 1.25);
    ali =
      Math.abs(d) > 40
        ? { drift: Math.round(d), mode: "nudge", rate: 1 + Math.min(0.05, (Math.abs(d) / 1000) * 0.25) }
        : { drift: Math.round(d) - 6 + jitter(2), mode: "synced", rate: 1 };
  }

  let ahmed: Lane;
  if (t < 1.4) ahmed = { drift: 920, mode: "jump", rate: 1 };
  else if (t < 2.3) ahmed = { drift: 14, mode: "jumped", rate: 1 };
  else if (t < 9) ahmed = { drift: 9 + jitter(3), mode: "synced", rate: 1 };
  else if (t < 9.8) ahmed = { drift: 680, mode: "jump", rate: 1 };
  else if (t < 10.7) ahmed = { drift: 12, mode: "jumped", rate: 1 };
  else ahmed = { drift: 8 + jitter(3), mode: "synced", rate: 1 };

  return [saad, ali, ahmed];
}

function laneLabel(l: Lane): { tone: "ok" | "warn" | "danger"; text: string; ring: boolean } {
  switch (l.mode) {
    case "synced":
      return { tone: "ok", text: "Synced", ring: false };
    case "nudge":
      return { tone: "warn", text: `Catching up ${l.rate.toFixed(2)}×`, ring: true };
    case "jump":
      return { tone: "danger", text: "Jump to room", ring: true };
    case "jumped":
      return { tone: "ok", text: "Back in sync", ring: false };
  }
}

const position = (drift: number) => `${Math.min(96, Math.max(4, 60 + (drift / 1000) * 30))}%`;

/** 03 / THE SYNC — make the invisible engineering visible. */
export function SyncSection() {
  const reduced = prefersReducedMotion();
  const [consoleRef, inView] = useInView<HTMLDivElement>(0.3);
  const [t, setT] = useState(reduced ? 6 : 0);
  useTicker(inView && !reduced, 100, () => setT((x) => (x + 0.1) % LOOP));

  const lanes = lanesAt(t);
  const allSynced = lanes.every((l) => l.mode === "synced");
  const worst = Math.max(...lanes.map((l) => Math.abs(l.drift)));
  const roomPos = 5072.418 + t;

  return (
    <section className="section sync" id="sync" aria-labelledby="sync-title">
      <TrailAnchor x={0.08} y="48%" />
      <div className="container sync__grid">
        <div className="sync__copy">
          <SectionHead
            num="03"
            name="The sync"
            id="sync-title"
            title={
              <>
                Everyone. <em>Same moment.</em>
              </>
            }
            sub="Playback state is synchronized in real time, with automatic drift correction."
          />
          <p className="sync__explain reveal">
            One room server keeps the authoritative clock. Your browser measures its offset, predicts exactly where the
            movie should be, and quietly nudges playback speed to stay within a few frames. Fall far behind? It jumps
            you straight back into the room.
          </p>
          <ul className="bands reveal">
            <li>
              <span className="bands__k is-ok">&lt; 40 ms</span>
              <span>Do nothing. Nobody can tell.</span>
            </li>
            <li>
              <span className="bands__k is-warm">40–500 ms</span>
              <span>Gentle catch-up — up to 5% faster or slower.</span>
            </li>
            <li>
              <span className="bands__k is-danger">&gt; 500 ms</span>
              <span>Jump to the room.</span>
            </li>
          </ul>
        </div>

        <div className="frame sync__console reveal" ref={consoleRef} aria-label="Animated sync console" role="img">
          <div className="console__head" aria-hidden="true">
            <span className="console__title pixel">Sync console</span>
            <span className={cx("console__readout", allSynced ? "is-ok" : "is-warm")}>
              <small>Sync</small>
              <span className="tnum">{worst}ms</span>
            </span>
          </div>

          <div className="console__lanes" aria-hidden="true">
            <div className="lane lane--head">
              <span />
              <span className="lane__track lane__track--head">
                <span className="console__roomtag" style={{ left: position(0) }}>
                  Room
                </span>
              </span>
              <span />
              <span />
            </div>
            {lanes.map((lane, i) => {
              const label = laneLabel(lane);
              const person = DEMO_PEOPLE[i]!;
              return (
                <div key={person.name} className={cx("lane", lane.mode === "jumped" && "is-snap")}>
                  <span className="lane__who">
                    <Avatar seed={person.seed} size={26} tone={label.tone === "ok" ? "ok" : label.tone === "warn" ? "warn" : "danger"} />
                    {person.name}
                  </span>
                  <span className="lane__track">
                    <i className="lane__room" style={{ left: position(0) }} />
                    <i className={cx("lane__head", `is-${label.tone}`)} style={{ left: position(lane.drift) }} />
                  </span>
                  <span className={cx("lane__drift tnum", `is-${label.tone}`)}>
                    {lane.drift > 0 ? "+" : ""}
                    {lane.drift}ms
                  </span>
                  <Badge tone={label.tone} ring={label.ring} className="lane__badge">
                    {label.text}
                  </Badge>
                </div>
              );
            })}
          </div>

          <dl className="health" aria-hidden="true">
            <div>
              <dt>Room position</dt>
              <dd className="tnum">{formatPrecise(roomPos)}</dd>
            </div>
            <div>
              <dt>Your position</dt>
              <dd className="tnum">{formatPrecise(roomPos + lanes[0]!.drift / 1000)}</dd>
            </div>
            <div>
              <dt>Drift</dt>
              <dd className="tnum is-ok">{lanes[0]!.drift}ms</dd>
            </div>
            <div>
              <dt>Buffer</dt>
              <dd className="tnum">4.2s</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd className="tnum is-ok">Good · 42ms</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
