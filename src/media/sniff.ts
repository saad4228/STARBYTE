/**
 * Container sniffing: which codecs are inside a media file, read straight from its headers.
 *
 * Browsers will happily load a movie whose audio they cannot decode and play it silently
 * (AC-3 / DTS in MKV is the classic). Knowing the codecs up front lets STARBYTE warn before
 * movie night instead of during it. Pure functions over a byte source, so they are unit-tested
 * with synthetic files and run unchanged inside the Web Worker.
 */

export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export type Container = "mp4" | "matroska" | "webm" | "avi" | "mpegts" | "unknown";

export interface CodecInfo {
  /** Short human label, e.g. "H.264". */
  label: string;
  /** MIME string for HTMLMediaElement.canPlayType, when one exists. */
  probe?: string;
}

export interface SniffResult {
  container: Container;
  video: CodecInfo | null;
  audio: CodecInfo[];
  subtitles: number;
}

const MP4: Record<string, { kind: "video" | "audio" | "text" } & CodecInfo> = {
  avc1: { kind: "video", label: "H.264", probe: 'video/mp4; codecs="avc1.640028"' },
  avc3: { kind: "video", label: "H.264", probe: 'video/mp4; codecs="avc3.640028"' },
  hvc1: { kind: "video", label: "HEVC", probe: 'video/mp4; codecs="hvc1.1.6.L120.90"' },
  hev1: { kind: "video", label: "HEVC", probe: 'video/mp4; codecs="hev1.1.6.L120.90"' },
  av01: { kind: "video", label: "AV1", probe: 'video/mp4; codecs="av01.0.08M.08"' },
  vp09: { kind: "video", label: "VP9", probe: 'video/mp4; codecs="vp09.00.40.08"' },
  vp08: { kind: "video", label: "VP8", probe: 'video/webm; codecs="vp8"' },
  mp4v: { kind: "video", label: "MPEG-4 Visual", probe: 'video/mp4; codecs="mp4v.20.9"' },
  mp4a: { kind: "audio", label: "AAC", probe: 'audio/mp4; codecs="mp4a.40.2"' },
  "ac-3": { kind: "audio", label: "AC-3", probe: 'audio/mp4; codecs="ac-3"' },
  "ec-3": { kind: "audio", label: "E-AC-3", probe: 'audio/mp4; codecs="ec-3"' },
  Opus: { kind: "audio", label: "Opus", probe: 'audio/mp4; codecs="opus"' },
  fLaC: { kind: "audio", label: "FLAC", probe: 'audio/mp4; codecs="flac"' },
  alac: { kind: "audio", label: "ALAC", probe: 'audio/mp4; codecs="alac"' },
  ".mp3": { kind: "audio", label: "MP3", probe: "audio/mpeg" },
  dtsc: { kind: "audio", label: "DTS", probe: 'audio/mp4; codecs="dtsc"' },
  dtsh: { kind: "audio", label: "DTS-HD", probe: 'audio/mp4; codecs="dtsh"' },
  dtsl: { kind: "audio", label: "DTS-HD", probe: 'audio/mp4; codecs="dtsl"' },
  tx3g: { kind: "text", label: "Timed text" },
  wvtt: { kind: "text", label: "WebVTT" },
  stpp: { kind: "text", label: "TTML" },
  c608: { kind: "text", label: "CEA-608" },
};

const MKV: [prefix: string, kind: "video" | "audio" | "text", info: CodecInfo][] = [
  ["V_MPEG4/ISO/AVC", "video", { label: "H.264", probe: 'video/mp4; codecs="avc1.640028"' }],
  ["V_MPEGH/ISO/HEVC", "video", { label: "HEVC", probe: 'video/mp4; codecs="hvc1.1.6.L120.90"' }],
  ["V_VP9", "video", { label: "VP9", probe: 'video/webm; codecs="vp9"' }],
  ["V_VP8", "video", { label: "VP8", probe: 'video/webm; codecs="vp8"' }],
  ["V_AV1", "video", { label: "AV1", probe: 'video/webm; codecs="av01.0.08M.08"' }],
  ["V_MPEG4/ISO", "video", { label: "MPEG-4 Visual", probe: 'video/mp4; codecs="mp4v.20.9"' }],
  ["V_MPEG2", "video", { label: "MPEG-2", probe: 'video/mpeg; codecs="mp2v"' }],
  ["V_MS/VFW", "video", { label: "VfW (legacy)" }],
  ["A_AAC", "audio", { label: "AAC", probe: 'audio/mp4; codecs="mp4a.40.2"' }],
  ["A_OPUS", "audio", { label: "Opus", probe: 'audio/webm; codecs="opus"' }],
  ["A_VORBIS", "audio", { label: "Vorbis", probe: 'audio/webm; codecs="vorbis"' }],
  ["A_EAC3", "audio", { label: "E-AC-3", probe: 'audio/mp4; codecs="ec-3"' }],
  ["A_AC3", "audio", { label: "AC-3", probe: 'audio/mp4; codecs="ac-3"' }],
  ["A_DTS", "audio", { label: "DTS", probe: 'audio/mp4; codecs="dtsc"' }],
  ["A_TRUEHD", "audio", { label: "TrueHD", probe: 'audio/mp4; codecs="mlpa"' }],
  ["A_FLAC", "audio", { label: "FLAC", probe: 'audio/webm; codecs="flac"' }],
  ["A_MPEG/L3", "audio", { label: "MP3", probe: "audio/mpeg" }],
  ["A_PCM", "audio", { label: "PCM", probe: 'audio/wav; codecs="1"' }],
  ["S_", "text", { label: "Subtitles" }],
];

const ascii = (b: Uint8Array, start: number, len: number) => {
  let s = "";
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
};
const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;

export async function sniff(src: ByteSource): Promise<SniffResult> {
  const head = await src.read(0, Math.min(src.size, 64 * 1024));
  const empty = (container: Container): SniffResult => ({ container, video: null, audio: [], subtitles: 0 });
  if (head.length >= 8 && ascii(head, 4, 4) === "ftyp") return sniffMp4(src);
  if (head.length >= 4 && u32(head, 0) === 0x1a45dfa3) return sniffMatroska(src, head);
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "AVI ") return empty("avi");
  if (head[0] === 0x47 && head[188] === 0x47) return empty("mpegts");
  return empty("unknown");
}

/* ── MP4 / MOV ───────────────────────────────────────────────────────────── */

interface Box {
  type: string;
  start: number; // offset of the payload within `data`
  end: number;
}

function* boxes(data: Uint8Array, from: number, to: number): Generator<Box> {
  let i = from;
  while (i + 8 <= to) {
    let size = u32(data, i);
    const type = ascii(data, i + 4, 4);
    let header = 8;
    if (size === 1) {
      if (i + 16 > to) return;
      size = u32(data, i + 8) * 2 ** 32 + u32(data, i + 12);
      header = 16;
    } else if (size === 0) {
      size = to - i;
    }
    if (size < header) return;
    yield { type, start: i + header, end: Math.min(to, i + size) };
    i += size;
  }
}

async function sniffMp4(src: ByteSource): Promise<SniffResult> {
  const result: SniffResult = { container: "mp4", video: null, audio: [], subtitles: 0 };
  // Walk top-level boxes by reading only their headers until we find `moov`
  // (it is at the start of web-optimized files and at the end of many others).
  let offset = 0;
  let moov: Uint8Array | null = null;
  while (offset + 8 <= src.size) {
    const h = await src.read(offset, 16);
    if (h.length < 8) break;
    let size = u32(h, 0);
    const type = ascii(h, 4, 4);
    let header = 8;
    if (size === 1) {
      size = u32(h, 8) * 2 ** 32 + u32(h, 12);
      header = 16;
    } else if (size === 0) {
      size = src.size - offset;
    }
    if (size < header) break;
    if (type === "moov") {
      if (size > 96 * 1024 * 1024) break; // absurd; give up rather than read it
      moov = await src.read(offset + header, size - header);
      break;
    }
    offset += size;
  }
  if (!moov) return result;

  for (const trak of boxes(moov, 0, moov.length)) {
    if (trak.type !== "trak") continue;
    let handler = "";
    let codec = "";
    const walk = (from: number, to: number) => {
      for (const b of boxes(moov!, from, to)) {
        if (b.type === "mdia" || b.type === "minf" || b.type === "stbl") walk(b.start, b.end);
        else if (b.type === "hdlr" && b.end - b.start >= 12) handler = ascii(moov!, b.start + 8, 4);
        else if (b.type === "stsd" && b.end - b.start >= 16) codec = ascii(moov!, b.start + 12, 4);
      }
    };
    walk(trak.start, trak.end);
    const info = MP4[codec];
    if (handler === "vide" && !result.video) result.video = info?.kind === "video" ? info : { label: codec || "Unknown" };
    else if (handler === "soun") result.audio.push(info?.kind === "audio" ? info : { label: codec || "Unknown" });
    else if (handler === "subt" || handler === "text" || handler === "sbtl" || handler === "clcp") result.subtitles++;
  }
  return result;
}

/* ── Matroska / WebM ─────────────────────────────────────────────────────── */

async function sniffMatroska(src: ByteSource, head: Uint8Array): Promise<SniffResult> {
  const isWebm = ascii(head, 0, Math.min(64, head.length)).includes("webm");
  const result: SniffResult = { container: isWebm ? "webm" : "matroska", video: null, audio: [], subtitles: 0 };
  // The Tracks element sits near the start, before the first Cluster. Scan the header region
  // for CodecID elements (ID 0x86, a 1–2 byte size, then an ASCII id like "A_AC3").
  const data = await src.read(0, Math.min(src.size, 4 * 1024 * 1024));
  for (let i = 0; i < data.length - 4; i++) {
    if (data[i] !== 0x86) continue;
    const b = data[i + 1]!;
    let len: number;
    let start: number;
    if (b & 0x80) {
      len = b & 0x7f;
      start = i + 2;
    } else if (b & 0x40) {
      len = ((b & 0x3f) << 8) | data[i + 2]!;
      start = i + 3;
    } else continue;
    if (len < 3 || len > 40 || start + len > data.length) continue;
    const id = ascii(data, start, len);
    if (!/^[VAS]_[A-Z0-9_/.-]+$/i.test(id)) continue;
    const match = MKV.find(([prefix]) => id.toUpperCase().startsWith(prefix));
    if (!match) continue;
    const [, kind, info] = match;
    if (kind === "video" && !result.video) result.video = info;
    else if (kind === "audio") result.audio.push(info);
    else if (kind === "text") result.subtitles++;
    i = start + len - 1;
  }
  return result;
}
