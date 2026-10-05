import { formatBytes, formatTime } from "../../shared/format";
import type { MediaFingerprint } from "../../shared/protocol";
import type { WorkerRequest, WorkerResponse } from "./media.worker";
import type { CodecInfo, SniffResult } from "./sniff";

/**
 * "ANALYZING MEDIA…" — everything STARBYTE learns about a local file before movie night.
 * The file never leaves the device: metadata comes from a detached <video> element, codecs and
 * the fingerprint from a Web Worker reading a few slices.
 */

export type StepId = "file" | "duration" | "size" | "video" | "audio" | "fingerprint";
export type StepStatus = "pending" | "ok" | "warn" | "fail";

export interface AnalysisStep {
  id: StepId;
  label: string;
  status: StepStatus;
  value?: string;
}

export interface MediaAnalysis {
  fingerprint: MediaFingerprint;
  container: string;
  warnings: string[];
}

export type AnalysisErrorCode = "unsupported" | "empty" | "read" | "timeout";

export class AnalysisError extends Error {
  constructor(
    readonly code: AnalysisErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const LABELS: Record<StepId, string> = {
  file: "Filename",
  duration: "Duration",
  size: "Size",
  video: "Video",
  audio: "Audio",
  fingerprint: "Fingerprint",
};

const EXT_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  ogv: "video/ogg",
  avi: "video/x-msvideo",
  ts: "video/mp2t",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
};

export function guessMime(name: string): string {
  return EXT_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** Accepted by the file picker. Matroska is listed by extension: many OSes give it no MIME type. */
export const MEDIA_ACCEPT = "video/*,audio/*,.mkv,.mp4,.m4v,.mov,.webm";

/* ── Worker plumbing ─────────────────────────────────────────────────────── */

type Pending = {
  resolve: (value: WorkerResponse) => void;
  reject: (err: Error) => void;
  onProgress?: (done: number, total: number) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./media.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === "progress") return p.onProgress?.(msg.done, msg.total);
    pending.delete(msg.id);
    if (msg.type === "error") p.reject(new AnalysisError("read", msg.message));
    else p.resolve(msg);
  };
  w.onerror = () => {
    for (const p of pending.values()) p.reject(new AnalysisError("read", "The media inspector crashed."));
    pending.clear();
    worker = null;
  };
  worker = w;
  return w;
}

function ask(msg: Omit<WorkerRequest, "id">, onProgress?: Pending["onProgress"]): Promise<WorkerResponse> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...msg, id } as WorkerRequest);
  });
}

/* ── Metadata ────────────────────────────────────────────────────────────── */

function waitFor(v: HTMLVideoElement, event: string, ms: number, accept: () => boolean = () => true): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      v.removeEventListener(event, ok);
      v.removeEventListener("error", fail);
    };
    const ok = () => {
      if (!accept()) return;
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new AnalysisError("unsupported", "This browser can't play this file's format."));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new AnalysisError("timeout", "The browser took too long to read this file."));
    }, ms);
    v.addEventListener(event, ok);
    v.addEventListener("error", fail);
  });
}

async function probeMetadata(file: File): Promise<{ duration: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.preload = "metadata";
  v.muted = true;
  v.playsInline = true;
  try {
    v.src = url;
    await waitFor(v, "loadedmetadata", 20_000);
    let duration = v.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      // Some encoders (MediaRecorder WebM, streamed MKV) omit the duration.
      // Seeking past the end makes the browser scan the file and compute it.
      v.currentTime = 1e101;
      await waitFor(v, "durationchange", 10_000, () => Number.isFinite(v.duration) && v.duration > 0).catch(() => {});
      duration = v.duration;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new AnalysisError("unsupported", "This file doesn't report its length, so it can't be synchronized.");
    }

    // Confirm the claimed end actually exists. Some files overstate their own length — a
    // recording that was interrupted, or a careless remux — and the room clamps every seek to
    // this number, so believing it would let people scrub to a place the file does not
    // contain and sit on "catching up" forever. Seeking there is the cheap way to find out.
    if (duration > 1) {
      v.currentTime = Math.max(0, duration - 0.25);
      await waitFor(v, "seeked", 8000).catch(() => {});
      const landed = v.currentTime;
      if (Number.isFinite(landed) && landed > 0.5 && landed < duration - 1) duration = landed;
    }

    return { duration, width: v.videoWidth, height: v.videoHeight };
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}

/* ── Analysis ────────────────────────────────────────────────────────────── */

export async function analyzeFile(file: File, onSteps: (steps: AnalysisStep[]) => void): Promise<MediaAnalysis> {
  const steps: AnalysisStep[] = (Object.keys(LABELS) as StepId[]).map((id) => ({ id, label: LABELS[id], status: "pending" }));
  const update = (id: StepId, patch: Partial<AnalysisStep>) => {
    Object.assign(steps.find((s) => s.id === id)!, patch);
    onSteps(steps.map((s) => ({ ...s })));
  };

  update("file", { status: "ok", value: file.name });
  if (file.size === 0) {
    update("size", { status: "fail", value: "0 B" });
    throw new AnalysisError("empty", "This file is empty.");
  }
  update("size", { status: "ok", value: formatBytes(file.size) });

  const inspection = ask({ type: "inspect", file });
  inspection.catch(() => {}); // surfaced below; avoid an unhandled rejection if metadata fails first

  let meta: { duration: number; width: number; height: number };
  try {
    meta = await probeMetadata(file);
  } catch (err) {
    update("duration", { status: "fail", value: "Not playable here" });
    throw err;
  }
  update("duration", { status: "ok", value: formatTime(meta.duration, true) });

  const res = await inspection;
  if (res.type !== "inspect") throw new AnalysisError("read", "Could not inspect this file.");
  const info: SniffResult = res.sniff;

  const probe = document.createElement("video");
  const playable = (c: CodecInfo) => !c.probe || probe.canPlayType(c.probe) !== "";
  const warnings: string[] = [];

  if (meta.width === 0) {
    update("video", { status: "warn", value: "No picture" });
    warnings.push(
      info.video && !playable(info.video)
        ? `${info.video.label} video can't be decoded in this browser — you'd only get sound. Try a copy encoded with H.264, VP9 or AV1.`
        : "This file has no picture — it will play as audio only.",
    );
  } else {
    const ok = !info.video || playable(info.video);
    const label = info.video?.label ?? "Decodes here";
    update("video", { status: ok ? "ok" : "warn", value: `${label} · ${meta.width}×${meta.height}` });
    if (!ok) warnings.push(`${label} video may not play smoothly in this browser.`);
  }

  if (info.audio.length === 0) {
    const known = info.container !== "unknown";
    update("audio", { status: known ? "warn" : "ok", value: known ? "No audio track" : "Decodes here" });
  } else {
    const labels = [...new Set(info.audio.map((a) => a.label))].join(", ");
    const value = info.audio.length > 1 ? `${labels} · ${info.audio.length} tracks` : labels;
    // Most browsers only ever play the first audio track.
    const first = info.audio[0]!;
    if (!playable(first)) {
      update("audio", { status: "warn", value });
      warnings.push(
        `${first.label} audio usually doesn't play in browsers — you may get picture without sound. A copy with AAC or Opus audio will work.`,
      );
    } else {
      update("audio", { status: "ok", value });
    }
  }

  update("fingerprint", { status: "ok", value: res.sampleHash.slice(0, 12) });

  const fingerprint: MediaFingerprint = {
    name: file.name,
    size: file.size,
    duration: meta.duration,
    mime: file.type || guessMime(file.name),
    width: meta.width,
    height: meta.height,
    sampleHash: res.sampleHash,
  };
  if (info.video) fingerprint.videoCodec = info.video.label;
  if (info.audio.length) fingerprint.audioCodecs = info.audio.map((a) => a.label).slice(0, 8);
  return { fingerprint, container: info.container, warnings };
}

/** Optional whole-file hash, for "verified identical" instead of "sampled". */
export async function deepVerify(file: File, onProgress: (fraction: number) => void): Promise<string> {
  const res = await ask({ type: "deep", file }, (done, total) => onProgress(done / total));
  if (res.type !== "deep") throw new AnalysisError("read", "Verification failed.");
  return res.fullHash;
}
