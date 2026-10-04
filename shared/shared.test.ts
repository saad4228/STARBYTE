import { describe, expect, it } from "vitest";
import { formatBytes, formatPrecise, formatTime } from "./format";
import { formatRoomId, newRoomId, normalizeRoomId, ROOM_ALPHABET } from "./ids";
import { compareMedia } from "./media";
import { positionAt, type MediaFingerprint, type PlaybackState } from "./protocol";

describe("positionAt", () => {
  const base: PlaybackState = { status: "playing", position: 100, anchor: 10_000, rate: 1, seq: 1, started: true };

  it("advances with server time while playing", () => {
    expect(positionAt(base, 12_500)).toBeCloseTo(102.5);
    expect(positionAt({ ...base, rate: 1.5 }, 12_000)).toBeCloseTo(103);
  });

  it("holds still before a future anchor (countdown) and while paused", () => {
    expect(positionAt(base, 9_000)).toBe(100);
    expect(positionAt({ ...base, status: "paused" }, 99_999)).toBe(100);
  });
});

describe("room ids", () => {
  it("generates ids from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const id = newRoomId();
      expect(id).toHaveLength(8);
      for (const ch of id) expect(ROOM_ALPHABET).toContain(ch);
    }
  });

  it("normalizes codes and invite links", () => {
    expect(normalizeRoomId("4h7k-9xqp")).toBe("4H7K9XQP");
    expect(normalizeRoomId("https://starbyte.app/r/4H7K9XQP")).toBe("4H7K9XQP");
    expect(normalizeRoomId("4H7K9XQ")).toBeNull();
    expect(normalizeRoomId("4H7K9XQ0")).toBeNull(); // 0 is not in the alphabet
    expect(formatRoomId("4H7K9XQP")).toBe("4H7K-9XQP");
  });
});

describe("compareMedia", () => {
  const ref: MediaFingerprint = {
    name: "Interstellar.mp4",
    size: 1000,
    duration: 10_153,
    mime: "video/mp4",
    width: 1920,
    height: 1080,
    sampleHash: "aaaaaaaaaaaaaaaa",
  };

  it("calls matching size + sample hash identical", () => {
    expect(compareMedia(ref, { ...ref, name: "renamed.mp4" }).match).toBe("identical");
  });

  it("treats a different encode with the same duration as compatible", () => {
    expect(compareMedia(ref, { ...ref, size: 900, sampleHash: "bbbbbbbbbbbbbbbb", duration: 10_152 }).match).toBe(
      "compatible",
    );
  });

  it("never trusts file names: same name, different length is a mismatch", () => {
    const result = compareMedia(ref, { ...ref, size: 1, sampleHash: "cccccccccccccccc", duration: 10_153 - 501 });
    expect(result.match).toBe("mismatch");
    expect(result.durationDelta).toBe(501);
  });

  it("lets a whole-file hash override the sampled check", () => {
    expect(compareMedia({ ...ref, fullHash: "11111111" }, { ...ref, fullHash: "22222222" }).match).toBe("compatible");
    expect(compareMedia({ ...ref, fullHash: "11111111" }, { ...ref, fullHash: "11111111" }).sameFull).toBe(true);
  });
});

describe("format", () => {
  it("formats media times", () => {
    expect(formatTime(5078.9)).toBe("01:24:38");
    expect(formatTime(95)).toBe("01:35");
    expect(formatTime(95, true)).toBe("00:01:35");
    expect(formatPrecise(5072.4185)).toBe("01:24:32.418");
    expect(formatTime(Number.NaN)).toBe("00:00");
  });

  it("formats sizes", () => {
    expect(formatBytes(4_200_000_000)).toBe("3.9 GB");
    expect(formatBytes(0)).toBe("0 B");
  });
});
