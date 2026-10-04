/**
 * Local subtitles. Like the movie, the subtitle file never leaves the device: it is converted
 * to WebVTT in memory and attached to the video as a <track>.
 */

/** SubRip → WebVTT: header, "," → "." in timestamps, padded hours, unsupported tags removed. */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/g, (_, h: string, m: string, s: string, ms: string) => {
      return `${h.padStart(2, "0")}:${m}:${s}.${ms.padEnd(3, "0")}`;
    })
    .replace(/\{\\[^}]*\}/g, "") // ASS-style override tags, e.g. {\an8}
    .replace(/<\/?font[^>]*>/gi, "")
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

export async function readSubtitleFile(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error("That subtitle file is unusually large.");
  const text = await file.text();
  if (/\.vtt$/i.test(file.name) || text.trimStart().startsWith("WEBVTT")) return text;
  if (/\.srt$/i.test(file.name) || text.includes("-->")) return srtToVtt(text);
  throw new Error("Use an .srt or .vtt subtitle file.");
}

/** Attach VTT text to a video. Returns a function that removes it again. */
export function attachSubtitles(video: HTMLVideoElement, vtt: string, label: string): () => void {
  const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
  const track = document.createElement("track");
  track.kind = "subtitles";
  track.label = label;
  track.srclang = "und";
  track.src = url;
  track.default = true;
  const show = () => {
    track.track.mode = "showing";
  };
  track.addEventListener("load", show);
  video.appendChild(track);
  show();
  return () => {
    track.removeEventListener("load", show);
    track.remove();
    URL.revokeObjectURL(url);
  };
}

export function setSubtitlesVisible(video: HTMLVideoElement, visible: boolean): void {
  for (const t of Array.from(video.textTracks)) t.mode = visible ? "showing" : "hidden";
}
