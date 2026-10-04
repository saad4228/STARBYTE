import { sniff, type ByteSource, type SniffResult } from "./sniff";

/**
 * Off-main-thread media work: sampled fingerprints, container sniffing and optional
 * whole-file verification. Files are read in slices; nothing is uploaded anywhere.
 */

export type WorkerRequest =
  | { id: number; type: "inspect"; file: File }
  | { id: number; type: "deep"; file: File };

export type WorkerResponse =
  | { id: number; type: "inspect"; sampleHash: string; sniff: SniffResult }
  | { id: number; type: "progress"; done: number; total: number }
  | { id: number; type: "deep"; fullHash: string }
  | { id: number; type: "error"; message: string };

const SAMPLE = 1 << 20; // 1 MiB
const DEEP_CHUNK = 8 << 20; // 8 MiB

const toHex = (buf: ArrayBuffer, chars = 32) => {
  let hex = "";
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, "0");
  return hex.slice(0, chars);
};

function fileSource(file: File): ByteSource {
  return {
    size: file.size,
    read: async (offset, length) =>
      new Uint8Array(await file.slice(offset, Math.min(file.size, offset + length)).arrayBuffer()),
  };
}

/** SHA-256 over the size plus 1 MiB from the start, middle and end. Fast even for 50 GB files. */
async function sampleHash(file: File): Promise<string> {
  const offsets = [...new Set([0, Math.max(0, Math.floor(file.size / 2) - SAMPLE / 2), Math.max(0, file.size - SAMPLE)])];
  const size = new ArrayBuffer(8);
  new DataView(size).setFloat64(0, file.size);
  const parts: BlobPart[] = [size];
  for (const off of offsets) parts.push(await file.slice(off, off + SAMPLE).arrayBuffer());
  return toHex(await crypto.subtle.digest("SHA-256", await new Blob(parts).arrayBuffer()));
}

/**
 * Whole-file hash. WebCrypto has no streaming digest, so hash each chunk and then hash the
 * concatenated chunk digests — deterministic, incremental, and constant memory.
 */
async function deepHash(id: number, file: File): Promise<string> {
  const total = Math.max(1, Math.ceil(file.size / DEEP_CHUNK));
  const digests = new Uint8Array(total * 32);
  for (let i = 0; i < total; i++) {
    const chunk = await file.slice(i * DEEP_CHUNK, (i + 1) * DEEP_CHUNK).arrayBuffer();
    digests.set(new Uint8Array(await crypto.subtle.digest("SHA-256", chunk)), i * 32);
    if (i % 4 === 3 || i === total - 1) post({ id, type: "progress", done: i + 1, total });
  }
  return toHex(await crypto.subtle.digest("SHA-256", digests));
}

function post(msg: WorkerResponse) {
  // Typed loosely: the app is compiled against the DOM lib, not the worker lib.
  (self as unknown as { postMessage(message: WorkerResponse): void }).postMessage(msg);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "inspect") {
      const [hash, info] = await Promise.all([sampleHash(msg.file), sniff(fileSource(msg.file)).catch(() => null)]);
      post({
        id: msg.id,
        type: "inspect",
        sampleHash: hash,
        sniff: info ?? { container: "unknown", video: null, audio: [], subtitles: 0 },
      });
    } else if (msg.type === "deep") {
      post({ id: msg.id, type: "deep", fullHash: await deepHash(msg.id, msg.file) });
    }
  } catch (err) {
    post({ id: msg.id, type: "error", message: err instanceof Error ? err.message : "Could not read this file." });
  }
};
