import { describe, expect, it } from "vitest";
import { LIMITS } from "../shared/constants";
import { parseClientMessage } from "./validate";

describe("parseClientMessage", () => {
  it("accepts well-formed control messages", () => {
    expect(parseClientMessage('{"t":"seek","pos":12.5,"aid":"a_1"}')).toEqual({ t: "seek", pos: 12.5, aid: "a_1" });
    expect(parseClientMessage('{"t":"ready","ready":true}')).toEqual({ t: "ready", ready: true });
  });

  it("rejects malformed or hostile payloads", () => {
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage('{"t":"seek","pos":"12"}')).toBeNull();
    expect(parseClientMessage('{"t":"seek","pos":1e999}')).toBeNull();
    expect(parseClientMessage('{"t":"rate","rate":3}')).toBeNull();
    expect(parseClientMessage('{"t":"nuke"}')).toBeNull();
    expect(parseClientMessage("[1,2,3]")).toBeNull();
  });

  it("drops invalid action ids and identity tokens instead of trusting them", () => {
    expect(parseClientMessage('{"t":"play","pos":0,"aid":"<script>"}')).toEqual({ t: "play", pos: 0, aid: undefined });
    const hello = parseClientMessage('{"t":"hello","v":1,"name":"Saad","pid":"../../etc","secret":"short"}');
    expect(hello).toMatchObject({ t: "hello", pid: undefined, secret: undefined });
  });

  it("validates media fingerprints field by field", () => {
    const good = {
      name: "Movie.mkv",
      size: 1000,
      duration: 6000,
      mime: "video/x-matroska",
      width: 1920,
      height: 1080,
      sampleHash: "0123456789abcdef",
      audioCodecs: ["AAC", 42],
    };
    expect(parseClientMessage(JSON.stringify({ t: "media", media: good }))).toMatchObject({
      t: "media",
      media: { name: "Movie.mkv", audioCodecs: ["AAC"] },
    });
    expect(parseClientMessage(JSON.stringify({ t: "media", media: { ...good, duration: -1 } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "media", media: { ...good, sampleHash: "XYZ" } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "media", media: null }))).toEqual({ t: "media", media: null });
  });

  it("keeps only known settings keys and values", () => {
    expect(
      parseClientMessage('{"t":"settings","settings":{"control":"host","autoStart":"maybe","admin":true}}'),
    ).toEqual({ t: "settings", settings: { control: "host" } });
  });
});

describe("source links", () => {
  const src = (url: unknown, kind: unknown = "link") =>
    parseClientMessage(JSON.stringify({ t: "source", source: { kind, url, name: "x" } }));

  it("accepts an https video link", () => {
    expect(src("https://cdn.example.com/a.mp4")).toEqual({
      t: "source",
      source: { kind: "link", url: "https://cdn.example.com/a.mp4", name: "x" },
    });
  });

  it("refuses schemes that would run or leak in someone else's browser", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:video/mp4;base64,AAAA",
      "blob:https://example.com/abc",
      "file:///etc/passwd",
      "http://cdn.example.com/a.mp4",
      "//cdn.example.com/a.mp4",
      "not a url",
      "",
    ]) {
      expect(src(url), url).toBeNull();
    }
  });

  it("refuses credentials embedded in the URL", () => {
    expect(src("https://user:pass@cdn.example.com/a.mp4")).toBeNull();
  });

  it("refuses an unknown source kind and over-long URLs", () => {
    expect(src("https://cdn.example.com/a.mp4", "youtube")).toBeNull();
    expect(src(`https://cdn.example.com/${"a".repeat(LIMITS.sourceUrlMax)}.mp4`)).toBeNull();
  });

  it("accepts clearing the source", () => {
    expect(parseClientMessage(JSON.stringify({ t: "source", source: null }))).toEqual({ t: "source", source: null });
  });

  it("falls back to a name when one is missing", () => {
    const msg = parseClientMessage(
      JSON.stringify({ t: "source", source: { kind: "drive", url: "https://drive.usercontent.google.com/download?id=a1b2c3d4e5f6" } }),
    );
    expect(msg).toMatchObject({ source: { name: "Shared source" } });
  });
});

describe("call and signalling", () => {
  it("parses call presence, defaulting to muted and video off", () => {
    expect(parseClientMessage(JSON.stringify({ t: "call", on: true }))).toEqual({
      t: "call",
      on: true,
      video: false,
      muted: true,
    });
  });

  it("requires a boolean for on", () => {
    expect(parseClientMessage(JSON.stringify({ t: "call", on: "yes" }))).toBeNull();
  });

  it("passes signalling through untouched but bounds it", () => {
    expect(parseClientMessage(JSON.stringify({ t: "rtc", to: "pid1", data: "{}" }))).toEqual({
      t: "rtc",
      to: "pid1",
      data: "{}",
    });
    expect(parseClientMessage(JSON.stringify({ t: "rtc", to: "pid1", data: "" }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ t: "rtc", to: "pid1", data: "x".repeat(LIMITS.rtcPayloadMax + 1) })),
    ).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "rtc", to: "bad pid!", data: "{}" }))).toBeNull();
  });
});
