/**
 * Source adapters. Every media source — a local file today; Drive, stream URLs and official
 * embeds later — exposes this one playback interface. The sync engine never knows where the
 * media came from.
 */

export type SourceKind = "local" | "drive" | "link" | "stream" | "youtube";

export type AdapterEvent =
  | "loadedmetadata"
  | "play"
  | "pause"
  | "playing"
  | "waiting"
  | "seeking"
  | "seeked"
  | "ended"
  | "ratechange"
  | "volumechange"
  | "error";

export interface MediaAdapter {
  readonly kind: SourceKind;
  /** Element to mount on the stage, for adapters that render one. */
  readonly element: HTMLElement | null;
  load(): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  /** Seconds of media buffered ahead of the playhead. */
  getBuffered(): number;
  isPaused(): boolean;
  isSeeking(): boolean;
  isBuffering(): boolean;
  getVolume(): number;
  setVolume(volume: number): void;
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  subscribe(listener: (event: AdapterEvent) => void): () => void;
  destroy(): void;
}
