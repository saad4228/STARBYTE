import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSource, SourceError } from "./sources";

/**
 * resolveSource only reaches for a <video> to ask whether the browser can play HLS, so the
 * tests stub that one call rather than pulling in a DOM.
 */
function stubCanPlay(result: string) {
  vi.stubGlobal("document", { createElement: () => ({ canPlayType: () => result }) });
}

afterEach(() => vi.unstubAllGlobals());

const fails = (input: string) => expect(() => resolveSource(input)).toThrow(SourceError);

describe("resolveSource", () => {
  it("takes a direct video link as it is", () => {
    expect(resolveSource("https://cdn.example.com/films/dune.mp4")).toMatchObject({
      kind: "link",
      url: "https://cdn.example.com/films/dune.mp4",
      name: "dune.mp4",
    });
  });

  it("warns, but still allows, a link that doesn't look like a video file", () => {
    const r = resolveSource("https://example.com/watch");
    expect(r.kind).toBe("link");
    expect(r.warning).toBeTruthy();
  });

  it("decodes a percent-escaped filename for display", () => {
    expect(resolveSource("https://cdn.example.com/The%20Matrix.mp4").name).toBe("The Matrix.mp4");
  });

  it("refuses anything that isn't https", () => {
    fails("http://cdn.example.com/a.mp4");
    fails("javascript:alert(1)");
    fails("data:video/mp4;base64,AAA");
    fails("file:///movies/a.mp4");
    fails("ftp://example.com/a.mp4");
    fails("");
    fails("just some words");
  });

  describe("Google Drive", () => {
    const direct = "https://drive.usercontent.google.com/download?id=1A2B3C4D5E6F7G&export=download";

    it("converts a shared /file/d/ link to a playable URL", () => {
      expect(resolveSource("https://drive.google.com/file/d/1A2B3C4D5E6F7G/view?usp=sharing")).toMatchObject({
        kind: "drive",
        url: direct,
      });
    });

    it("handles the ?id= and /open shapes too", () => {
      expect(resolveSource("https://drive.google.com/open?id=1A2B3C4D5E6F7G").url).toBe(direct);
      expect(resolveSource("https://drive.google.com/uc?export=download&id=1A2B3C4D5E6F7G").url).toBe(direct);
    });

    it("says so when given a folder rather than a file", () => {
      expect(() => resolveSource("https://drive.google.com/drive/folders/1A2B3C4D5E6F7G")).toThrow(/folder/i);
    });

    it("rejects a Drive URL with no file id", () => {
      fails("https://drive.google.com/drive/my-drive");
    });

    it("tells the host about the sharing requirement up front", () => {
      expect(resolveSource("https://drive.google.com/file/d/1A2B3C4D5E6F7G/view").warning).toMatch(/anyone with the link/i);
    });
  });

  describe("streaming formats", () => {
    it("allows HLS where the browser plays it", () => {
      stubCanPlay("maybe");
      expect(resolveSource("https://cdn.example.com/live/stream.m3u8").kind).toBe("link");
    });

    it("explains the problem where it does not", () => {
      stubCanPlay("");
      expect(() => resolveSource("https://cdn.example.com/live/stream.m3u8")).toThrow(/HLS/i);
    });

    it("turns DASH away with a reason", () => {
      expect(() => resolveSource("https://cdn.example.com/live/stream.mpd")).toThrow(/DASH/i);
    });
  });
});

describe("YouTube links", () => {
  const ID = "dQw4w9WgXcQ";
  const expectId = (input: string) =>
    expect(resolveSource(input)).toMatchObject({ kind: "youtube", url: `https://www.youtube.com/watch?v=${ID}` });

  it("accepts every shape a YouTube link is copied in", () => {
    expectId(`https://www.youtube.com/watch?v=${ID}`);
    expectId(`https://youtube.com/watch?v=${ID}`);
    expectId(`https://m.youtube.com/watch?v=${ID}`);
    expectId(`https://youtu.be/${ID}`);
    expectId(`https://youtu.be/${ID}?t=42`);
    expectId(`https://www.youtube.com/embed/${ID}`);
    expectId(`https://www.youtube.com/shorts/${ID}`);
    expectId(`https://www.youtube.com/live/${ID}`);
    expectId(`https://www.youtube-nocookie.com/embed/${ID}`);
    expectId(`https://www.youtube.com/watch?v=${ID}&list=PL123&index=2`);
  });

  it("warns that the owner may have blocked embedding", () => {
    expect(resolveSource(`https://youtu.be/${ID}`).warning).toMatch(/embedding/i);
  });

  it("says what's wrong with a YouTube link that has no video in it", () => {
    expect(() => resolveSource("https://www.youtube.com/feed/subscriptions")).toThrow(/video id/i);
    expect(() => resolveSource("https://www.youtube.com/@someone")).toThrow(/video id/i);
  });

  it("doesn't mistake a lookalike host for YouTube", () => {
    const r = resolveSource("https://notyoutube.com/watch?v=dQw4w9WgXcQ");
    expect(r.kind).toBe("link");
  });
});
