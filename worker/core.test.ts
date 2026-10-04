import { describe, expect, it } from "vitest";
import { LIMITS, TIMING } from "../shared/constants";
import type { MediaFingerprint, ServerMessage } from "../shared/protocol";
import { Effects, RoomCore, newRoomData, type HelloInput } from "./core";

let counter = 0;
const deps = { randomId: (n: number) => `id${++counter}`.padEnd(n, "x") };

const MOVIE: MediaFingerprint = {
  name: "Interstellar.mp4",
  size: 4_200_000_000,
  duration: 10_153,
  mime: "video/mp4",
  width: 1920,
  height: 1080,
  sampleHash: "aaaaaaaaaaaaaaaa",
};

function makeRoom(control: "everyone" | "host" = "everyone") {
  return new RoomCore(
    newRoomData({ id: "4H7K9XQP", name: "Friday Night", hostName: "Saad", control, hostKeyHash: "HOSTHASH", now: 0 }),
    deps,
  );
}

function join(core: RoomCore, name: string, now = 0, extra: Partial<HelloInput> = {}) {
  const fx = new Effects();
  const n = ++counter;
  const result = core.hello(
    {
      name,
      fresh: { pid: `pid${n}`, secret: `secret${n}`, secretHash: `hash${n}`, avatar: n },
      ...extra,
    },
    now,
    fx,
  );
  if (!result.ok) throw new Error(result.message);
  return { pid: result.pid, fx };
}

function sent(fx: Effects, type: ServerMessage["t"]) {
  return fx.out.filter((o) => o.msg.t === type).map((o) => o.msg);
}

describe("RoomCore presence", () => {
  it("makes the hostKey holder host, even when someone else arrived first", () => {
    const core = makeRoom();
    const ali = join(core, "Ali");
    expect(core.find(ali.pid)?.host).toBe(true); // acting host while the creator is away

    const saad = join(core, "Saad", 0, { hostKeyHash: "HOSTHASH" });
    expect(core.find(saad.pid)?.host).toBe(true);
    expect(core.find(ali.pid)?.host).toBe(false);
  });

  it("resumes an existing participant with the right secret and keeps their state", () => {
    const core = makeRoom();
    const saad = join(core, "Saad", 0, { hostKeyHash: "HOSTHASH" });
    const record = core.find(saad.pid)!;
    core.handle(saad.pid, { t: "media", media: MOVIE }, 10, new Effects());
    core.disconnect(saad.pid, 20, false, new Effects());
    expect(record.online).toBe(false);

    const fx = new Effects();
    const result = core.hello(
      { name: "Saad", pid: saad.pid, secretHash: record.secretHash, fresh: { pid: "new", secret: "s", secretHash: "h", avatar: 1 } },
      30,
      fx,
    );
    expect(result).toMatchObject({ ok: true, pid: saad.pid, resumed: true });
    expect(record.online).toBe(true);
    expect(record.media?.sampleHash).toBe(MOVIE.sampleHash);
  });

  it("refuses to resume with a wrong secret and issues a fresh identity instead", () => {
    const core = makeRoom();
    const saad = join(core, "Saad");
    const result = core.hello(
      { name: "Mallory", pid: saad.pid, secretHash: "nope", fresh: { pid: "freshpid", secret: "s", secretHash: "h", avatar: 1 } },
      5,
      new Effects(),
    );
    expect(result).toMatchObject({ ok: true, pid: "freshpid", resumed: false });
    expect(core.find(saad.pid)?.name).toBe("Saad");
  });

  it("rejects joins once the room is full", () => {
    const core = makeRoom();
    for (let i = 0; i < LIMITS.maxParticipants; i++) join(core, `Viewer ${i}`);
    const result = core.hello({ name: "Late", fresh: { pid: "late", secret: "s", secretHash: "h", avatar: 1 } }, 0, new Effects());
    expect(result).toMatchObject({ ok: false, code: "room_full" });
  });

  it("removes dropped viewers after the grace period and promotes a new host", () => {
    const core = makeRoom();
    const saad = join(core, "Saad", 0, { hostKeyHash: "HOSTHASH" });
    const ali = join(core, "Ali", 1);
    core.disconnect(saad.pid, 100, false, new Effects());
    core.sweep(100 + TIMING.reconnectGraceMs - 1, new Effects());
    expect(core.find(saad.pid)).toBeDefined();
    core.sweep(100 + TIMING.reconnectGraceMs, new Effects());
    expect(core.find(saad.pid)).toBeUndefined();
    expect(core.find(ali.pid)?.host).toBe(true);
  });
});

describe("RoomCore playback", () => {
  function roomWithMovie(control: "everyone" | "host" = "everyone") {
    const core = makeRoom(control);
    const saad = join(core, "Saad", 0, { hostKeyHash: "HOSTHASH" });
    const ali = join(core, "Ali");
    core.handle(saad.pid, { t: "media", media: MOVIE }, 0, new Effects());
    return { core, saad: saad.pid, ali: ali.pid };
  }

  it("adopts the first controller's media as the room media", () => {
    const { core } = roomWithMovie();
    expect(core.data.media?.sampleHash).toBe(MOVIE.sampleHash);
    expect(core.data.playback).toMatchObject({ status: "paused", position: 0, started: false });
  });

  it("does not let a non-controller define the room media", () => {
    const core = makeRoom("host");
    join(core, "Saad", 0, { hostKeyHash: "HOSTHASH" });
    const ali = join(core, "Ali");
    core.handle(ali.pid, { t: "media", media: MOVIE }, 0, new Effects());
    expect(core.data.media).toBeNull();
  });

  it("starts with a countdown the first time and a short lead afterwards", () => {
    const { core, saad } = roomWithMovie();
    core.handle(saad, { t: "play", pos: 0 }, 1000, new Effects());
    expect(core.data.playback).toMatchObject({ status: "playing", started: true, anchor: 1000 + TIMING.countdownMs });

    core.handle(saad, { t: "pause", pos: 30 }, 40_000, new Effects());
    expect(core.data.playback).toMatchObject({ status: "paused", position: 30 });

    core.handle(saad, { t: "play", pos: 30 }, 50_000, new Effects());
    expect(core.data.playback.anchor).toBe(50_000 + TIMING.resumeLeadMs);
  });

  it("drops back into the ready check when the first countdown is cancelled", () => {
    const { core, saad } = roomWithMovie();
    core.handle(saad, { t: "play", pos: 0 }, 1000, new Effects());
    core.handle(saad, { t: "pause", pos: 0 }, 2000, new Effects());
    expect(core.data.playback).toMatchObject({ status: "paused", started: false, position: 0 });
  });

  it("ignores an implausible pause position and uses the room clock instead", () => {
    const { core, saad } = roomWithMovie();
    core.handle(saad, { t: "play", pos: 0 }, 0, new Effects());
    const anchor = core.data.playback.anchor;
    core.handle(saad, { t: "pause", pos: 999 }, anchor + 10_000, new Effects());
    expect(core.data.playback.position).toBeCloseTo(10, 5);
  });

  it("enforces host-only control and resends state so the client can roll back", () => {
    const { core, ali } = roomWithMovie("host");
    const fx = new Effects();
    core.handle(ali, { t: "play", pos: 0, aid: "a1" }, 0, fx);
    expect(core.data.playback.status).toBe("paused");
    expect(sent(fx, "error")[0]).toMatchObject({ code: "forbidden", aid: "a1" });
    expect(sent(fx, "playback")).toHaveLength(1);
  });

  it("lets the host grant control to a guest", () => {
    const { core, saad, ali } = roomWithMovie("host");
    core.handle(saad, { t: "grant", pid: ali, control: true }, 0, new Effects());
    core.handle(ali, { t: "play", pos: 0 }, 0, new Effects());
    expect(core.data.playback.status).toBe("playing");
  });

  it("clamps seeks to the media duration and keeps a pending countdown's start time", () => {
    const { core, saad } = roomWithMovie();
    core.handle(saad, { t: "seek", pos: 99_999 }, 0, new Effects());
    expect(core.data.playback.position).toBe(MOVIE.duration);

    core.handle(saad, { t: "seek", pos: 0 }, 0, new Effects());
    core.handle(saad, { t: "play", pos: 0 }, 1000, new Effects());
    const anchor = core.data.playback.anchor;
    core.handle(saad, { t: "seek", pos: 120 }, 2000, new Effects());
    expect(core.data.playback).toMatchObject({ position: 120, anchor });
  });

  it("auto-starts once every connected viewer is ready", () => {
    const { core, saad, ali } = roomWithMovie();
    core.handle(ali, { t: "media", media: MOVIE }, 0, new Effects());
    core.handle(saad, { t: "ready", ready: true }, 0, new Effects());
    expect(core.data.playback.started).toBe(false);
    const fx = new Effects();
    core.handle(ali, { t: "ready", ready: true }, 500, fx);
    expect(core.data.playback).toMatchObject({ status: "playing", started: true });
    expect(sent(fx, "playback")[0]).toMatchObject({ cause: { pid: null, kind: "autostart" } });
  });

  it("refuses to mark ready without media", () => {
    const { core, ali } = roomWithMovie();
    const fx = new Effects();
    core.handle(ali, { t: "ready", ready: true }, 0, fx);
    expect(core.find(ali)?.ready).toBe(false);
    expect(sent(fx, "error")).toHaveLength(1);
  });

  it("pauses on unexpected disconnects only when the room asks for it", () => {
    const { core, saad, ali } = roomWithMovie();
    core.handle(saad, { t: "play", pos: 0 }, 0, new Effects());
    const anchor = core.data.playback.anchor;
    core.disconnect(ali, anchor + 5000, false, new Effects());
    expect(core.data.playback.status).toBe("playing");

    core.handle(saad, { t: "settings", settings: { pauseOnDisconnect: true } }, anchor + 6000, new Effects());
    const bob = join(core, "Bob", anchor + 6000);
    core.disconnect(bob.pid, anchor + 7000, false, new Effects());
    expect(core.data.playback).toMatchObject({ status: "paused" });
    expect(core.data.playback.position).toBeCloseTo(7, 5);
  });

  it("only ends playback when the room clock agrees the media is over", () => {
    const { core, saad, ali } = roomWithMovie();
    core.handle(saad, { t: "play", pos: 0 }, 0, new Effects());
    const anchor = core.data.playback.anchor;
    core.handle(ali, { t: "ended" }, anchor + 60_000, new Effects());
    expect(core.data.playback.status).toBe("playing");
    core.handle(ali, { t: "ended" }, anchor + MOVIE.duration * 1000, new Effects());
    expect(core.data.playback).toMatchObject({ status: "paused", position: MOVIE.duration });
  });

  it("keeps readiness when only a whole-file hash is added, and records it on the room media", () => {
    const { core, saad, ali } = roomWithMovie("host");
    core.handle(ali, { t: "media", media: MOVIE }, 0, new Effects());
    core.handle(ali, { t: "ready", ready: true }, 0, new Effects());
    core.handle(ali, { t: "media", media: { ...MOVIE, fullHash: "ffffffffffffffff" } }, 0, new Effects());
    expect(core.find(ali)?.ready).toBe(true);
    expect(core.data.media?.fullHash).toBeUndefined(); // guests can't stamp the reference

    core.handle(saad, { t: "media", media: { ...MOVIE, fullHash: "ffffffffffffffff" } }, 0, new Effects());
    expect(core.data.media?.fullHash).toBe("ffffffffffffffff");
  });

  it("resets readiness and moments when a controller switches the room media", () => {
    const { core, saad, ali } = roomWithMovie();
    core.handle(ali, { t: "media", media: MOVIE }, 0, new Effects());
    core.handle(ali, { t: "ready", ready: true }, 0, new Effects());
    core.handle(saad, { t: "moment", pos: 10, emoji: "😂", caption: "lol" }, 0, new Effects());
    const other = { ...MOVIE, sampleHash: "bbbbbbbbbbbbbbbb", duration: 7000 };
    core.handle(saad, { t: "media", media: other }, 0, new Effects());
    core.handle(saad, { t: "adoptMedia" }, 0, new Effects());
    expect(core.data.media?.sampleHash).toBe(other.sampleHash);
    expect(core.find(ali)?.ready).toBe(false);
    expect(core.data.moments).toHaveLength(0);
  });
});

describe("RoomCore social", () => {
  it("cleans chat, caps history and rate-limits floods", () => {
    const core = makeRoom();
    const saad = join(core, "Saad");
    const fx = new Effects();
    core.handle(saad.pid, { t: "chat", text: "  this   scene ‮💀  " }, 0, fx);
    expect(core.data.chat[0]?.text).toBe("this scene 💀");

    let limited = 0;
    for (let i = 0; i < 20; i++) {
      const f = new Effects();
      core.handle(saad.pid, { t: "chat", text: `msg ${i}` }, 1, f);
      if (sent(f, "error").length) limited++;
    }
    expect(limited).toBeGreaterThan(0);

    for (let i = 0; i < 300; i++) core.handle(saad.pid, { t: "chat", text: `later ${i}` }, 10_000 * (i + 1), new Effects());
    expect(core.data.chat.length).toBe(LIMITS.chatHistory);
  });

  it("broadcasts reactions to everyone else and ignores unknown emoji", () => {
    const core = makeRoom();
    const saad = join(core, "Saad");
    const fx = new Effects();
    core.handle(saad.pid, { t: "react", emoji: "🔥" }, 0, fx);
    core.handle(saad.pid, { t: "react", emoji: "🍕" }, 0, fx);
    expect(fx.out).toHaveLength(1);
    expect(fx.out[0]?.to).toEqual({ kind: "others", except: saad.pid });
  });

  it("stores moments with sanitized captions and a fallback emoji", () => {
    const core = makeRoom();
    const saad = join(core, "Saad", 0, { hostKeyHash: "HOSTHASH" });
    core.handle(saad.pid, { t: "media", media: MOVIE }, 0, new Effects());
    core.handle(saad.pid, { t: "moment", pos: 5078.4, emoji: "🍕", caption: "x".repeat(500) }, 0, new Effects());
    expect(core.data.moments[0]).toMatchObject({ position: 5078.4, emoji: "🔥", name: "Saad" });
    expect(core.data.moments[0]?.caption.length).toBe(LIMITS.captionMax);
  });

  it("restricts room settings to the host", () => {
    const core = makeRoom();
    join(core, "Saad", 0, { hostKeyHash: "HOSTHASH" });
    const ali = join(core, "Ali");
    const fx = new Effects();
    core.handle(ali.pid, { t: "settings", name: "Ali's Room" }, 0, fx);
    expect(core.data.meta.name).toBe("Friday Night");
    expect(sent(fx, "error")[0]).toMatchObject({ code: "forbidden" });
  });
});

describe("RoomCore shared sources", () => {
  const LINK = { kind: "link" as const, url: "https://cdn.example.com/film.mp4", name: "film.mp4" };

  it("lets a controller point the room at a link and tells everyone", () => {
    const core = makeRoom();
    const ali = join(core, "Ali");
    const fx = new Effects();
    core.handle(ali.pid, { t: "source", source: LINK }, 1000, fx);

    const rooms = sent(fx, "room") as Extract<ServerMessage, { t: "room" }>[];
    const room = rooms[0]!;
    expect(room.source).toMatchObject({ ...LINK, pid: ali.pid, at: 1000 });
    expect(core.snapshot().source?.url).toBe(LINK.url);
  });

  it("refuses a viewer without control", () => {
    const core = makeRoom("host");
    join(core, "Ali"); // acting host
    const bo = join(core, "Bo");
    const fx = new Effects();
    core.handle(bo.pid, { t: "source", source: LINK }, 1000, fx);
    expect(core.snapshot().source).toBeNull();
    expect(sent(fx, "error")).toHaveLength(1);
  });

  it("clears everyone's media so the room re-checks against the new source", () => {
    const core = makeRoom();
    const ali = join(core, "Ali");
    const bo = join(core, "Bo");
    core.handle(ali.pid, { t: "media", media: MOVIE }, 10, new Effects());
    core.handle(bo.pid, { t: "media", media: MOVIE }, 10, new Effects());
    core.handle(bo.pid, { t: "ready", ready: true }, 10, new Effects());
    expect(core.snapshot().media).not.toBeNull();

    core.handle(ali.pid, { t: "source", source: LINK }, 20, new Effects());
    const snap = core.snapshot();
    expect(snap.media).toBeNull();
    expect(snap.participants.every((p) => p.media === null && !p.ready)).toBe(true);
    expect(snap.playback.started).toBe(false);
  });

  it("drops the link and goes back to everyone's own file", () => {
    const core = makeRoom();
    const ali = join(core, "Ali");
    core.handle(ali.pid, { t: "source", source: LINK }, 10, new Effects());
    core.handle(ali.pid, { t: "source", source: null }, 20, new Effects());
    expect(core.snapshot().source).toBeNull();
  });
});

describe("RoomCore call", () => {
  it("broadcasts who is in the call", () => {
    const core = makeRoom();
    const ali = join(core, "Ali");
    const fx = new Effects();
    core.handle(ali.pid, { t: "call", on: true, video: true, muted: false }, 10, fx);
    expect(core.find(ali.pid)?.call).toEqual({ on: true, video: true, muted: false });
    expect(sent(fx, "participant")).toHaveLength(1);
  });

  it("caps the mesh at maxCallers", () => {
    const core = makeRoom();
    const joined = [];
    for (let i = 0; i < LIMITS.maxCallers; i++) joined.push(join(core, `P${i}`));
    for (const p of joined) core.handle(p.pid, { t: "call", on: true, video: false, muted: false }, 10, new Effects());

    const extra = join(core, "Late");
    const fx = new Effects();
    core.handle(extra.pid, { t: "call", on: true, video: false, muted: false }, 10, fx);
    expect(core.find(extra.pid)?.call).toBeNull();
    expect(sent(fx, "error")[0]).toMatchObject({ code: "capacity" });
  });

  it("relays signalling only to the addressed peer", () => {
    const core = makeRoom();
    const ali = join(core, "Ali");
    const bo = join(core, "Bo");
    join(core, "Cy");
    const fx = new Effects();
    core.handle(ali.pid, { t: "rtc", to: bo.pid, data: "{\"candidate\":1}" }, 10, fx);

    expect(fx.out).toEqual([
      { to: { kind: "one", pid: bo.pid }, msg: { t: "rtc", from: ali.pid, data: "{\"candidate\":1}" } },
    ]);
  });

  it("drops signalling aimed at a stranger or at yourself", () => {
    const core = makeRoom();
    const ali = join(core, "Ali");
    const fx = new Effects();
    core.handle(ali.pid, { t: "rtc", to: "nobody", data: "x" }, 10, fx);
    core.handle(ali.pid, { t: "rtc", to: ali.pid, data: "x" }, 10, fx);
    expect(fx.out).toHaveLength(0);
  });

  it("marks a dropped viewer as out of the call so peers tear down", () => {
    const core = makeRoom();
    const ali = join(core, "Ali");
    join(core, "Bo");
    core.handle(ali.pid, { t: "call", on: true, video: true, muted: false }, 10, new Effects());
    core.disconnect(ali.pid, 20, false, new Effects());
    expect(core.find(ali.pid)?.call?.on).toBe(false);
  });
});

describe("RoomCore duration corrections", () => {
  const shorter: MediaFingerprint = { ...MOVIE, duration: 57 };

  it("takes a re-measured length for the same file, so seeks aren't clamped short", () => {
    const core = makeRoom();
    const ali = join(core, "Ali");
    core.handle(ali.pid, { t: "media", media: shorter }, 10, new Effects());
    expect(core.snapshot().media?.duration).toBe(57);

    const fx = new Effects();
    core.handle(ali.pid, { t: "media", media: MOVIE }, 20, fx);
    expect(core.snapshot().media?.duration).toBe(MOVIE.duration);
    const [room] = sent(fx, "room") as Extract<ServerMessage, { t: "room" }>[];
    expect(room?.media?.duration).toBe(MOVIE.duration);
  });

  it("does not treat a re-measure as swapping the file, so readiness survives", () => {
    const core = makeRoom();
    const ali = join(core, "Ali");
    core.handle(ali.pid, { t: "media", media: shorter }, 10, new Effects());
    core.handle(ali.pid, { t: "ready", ready: true }, 10, new Effects());
    expect(core.find(ali.pid)?.ready).toBe(true);

    core.handle(ali.pid, { t: "media", media: MOVIE }, 20, new Effects());
    expect(core.find(ali.pid)?.ready).toBe(true);
  });

  it("still treats genuinely different bytes as a different file", () => {
    const core = makeRoom();
    const ali = join(core, "Ali");
    core.handle(ali.pid, { t: "media", media: MOVIE }, 10, new Effects());
    core.handle(ali.pid, { t: "ready", ready: true }, 10, new Effects());

    core.handle(ali.pid, { t: "media", media: { ...MOVIE, sampleHash: "bbbbbbbbbbbbbbbb" } }, 20, new Effects());
    expect(core.find(ali.pid)?.ready).toBe(false);
  });

  it("lets a corrected length raise the ceiling that seeks are clamped to", () => {
    const core = makeRoom();
    const ali = join(core, "Ali");
    core.handle(ali.pid, { t: "media", media: shorter }, 10, new Effects());
    core.handle(ali.pid, { t: "start" }, 20, new Effects());

    core.handle(ali.pid, { t: "seek", pos: 400 }, 30, new Effects());
    expect(core.snapshot().playback.position).toBeLessThanOrEqual(57);

    core.handle(ali.pid, { t: "media", media: MOVIE }, 40, new Effects());
    core.handle(ali.pid, { t: "seek", pos: 400 }, 50, new Effects());
    expect(core.snapshot().playback.position).toBeCloseTo(400, 0);
  });
});
