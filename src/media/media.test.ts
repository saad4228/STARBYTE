import { describe, expect, it } from "vitest";
import { sniff, type ByteSource } from "./sniff";
import { srtToVtt } from "./subtitles";

const enc = new TextEncoder();

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = cat(...payload);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(enc.encode(type), 4);
  out.set(body, 8);
  return out;
}

const zeros = (n: number) => new Uint8Array(n);

function trak(handler: string, codec: string): Uint8Array {
  const hdlr = box("hdlr", zeros(4), zeros(4), enc.encode(handler), zeros(12), zeros(1));
  const entry = box(codec, zeros(16));
  const stsd = box("stsd", zeros(4), new Uint8Array([0, 0, 0, 1]), entry);
  return box("trak", box("tkhd", zeros(20)), box("mdia", hdlr, box("minf", box("stbl", stsd))));
}

function source(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (o, l) => bytes.slice(o, o + l) };
}

describe("sniff — MP4", () => {
  it("finds video and audio codecs with moov after mdat", async () => {
    const file = cat(
      box("ftyp", enc.encode("isom"), zeros(4)),
      box("mdat", zeros(5000)),
      box("moov", box("mvhd", zeros(100)), trak("vide", "avc1"), trak("soun", "mp4a"), trak("soun", "ac-3")),
    );
    const result = await sniff(source(file));
    expect(result.container).toBe("mp4");
    expect(result.video?.label).toBe("H.264");
    expect(result.audio.map((a) => a.label)).toEqual(["AAC", "AC-3"]);
  });

  it("reports unknown codecs by their four-character code", async () => {
    const file = cat(box("ftyp", zeros(8)), box("moov", trak("vide", "xyz1")));
    expect((await sniff(source(file))).video?.label).toBe("xyz1");
  });
});

describe("sniff — Matroska", () => {
  const codecId = (id: string) => cat(new Uint8Array([0x86, 0x80 | id.length]), enc.encode(id));

  it("reads CodecIDs and counts audio and subtitle tracks", async () => {
    const file = cat(
      new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      enc.encode("....matroska...."),
      zeros(200),
      codecId("V_MPEG4/ISO/AVC"),
      zeros(40),
      codecId("A_AC3"),
      zeros(40),
      codecId("A_AAC"),
      codecId("S_TEXT/UTF8"),
      zeros(1000),
    );
    const result = await sniff(source(file));
    expect(result.container).toBe("matroska");
    expect(result.video?.label).toBe("H.264");
    expect(result.audio.map((a) => a.label)).toEqual(["AC-3", "AAC"]);
    expect(result.subtitles).toBe(1);
  });

  it("distinguishes WebM", async () => {
    const file = cat(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), enc.encode("webm"), codecId("V_VP9"), codecId("A_OPUS"));
    const result = await sniff(source(file));
    expect(result).toMatchObject({ container: "webm", video: { label: "VP9" } });
    expect(result.audio[0]?.label).toBe("Opus");
  });
});

describe("srtToVtt", () => {
  it("converts timestamps, pads hours and strips unsupported markup", () => {
    const srt = "﻿1\r\n0:01:02,5 --> 00:01:05,000\r\n{\\an8}<font color=\"red\">Hello</font> <i>there</i>\r\n";
    expect(srtToVtt(srt)).toBe("WEBVTT\n\n1\n00:01:02.500 --> 00:01:05.000\nHello <i>there</i>\n");
  });
});
