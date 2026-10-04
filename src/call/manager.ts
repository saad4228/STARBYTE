import { CALL_CONNECT_TIMEOUT_MS, ICE_SERVERS } from "../../shared/constants";

/**
 * The voice/video call: a full mesh of peer connections, signalled through the room socket.
 *
 * The room server only relays offers, answers and ICE candidates — audio and video go straight
 * between browsers and never touch the server, for the same reason the movie never does.
 *
 * Two things keep this simpler than it looks:
 *   - Perfect negotiation. Both sides may offer at once; the "polite" peer (lower id) rolls back
 *     instead of both sides deadlocking.
 *   - Fixed transceivers. Every connection is built with one audio and one video slot up front,
 *     so turning a camera on or off is `replaceTrack` — no renegotiation, no SDP churn mid-call.
 */

export type PeerStatus = "connecting" | "connected" | "failed";

export interface PeerSnapshot {
  pid: string;
  stream: MediaStream | null;
  status: PeerStatus;
}

export interface CallSnapshot {
  /** We are publishing to the call. */
  joined: boolean;
  /** Waiting on the camera/mic permission prompt. */
  joining: boolean;
  muted: boolean;
  video: boolean;
  local: MediaStream | null;
  peers: PeerSnapshot[];
  /** Participant ids currently making sound, including possibly our own. */
  speaking: readonly string[];
  error: string | null;
  /** True once at least one peer has failed to connect, so the UI can explain why. */
  blocked: boolean;
}

interface Signal {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

interface Peer {
  pid: string;
  pc: RTCPeerConnection;
  /** Null on the answering side until the offer arrives and the slots exist. */
  audio: RTCRtpSender | null;
  video: RTCRtpSender | null;
  /** Hidden sink so remote audio is audible even when the bubble shows no video. */
  sink: HTMLAudioElement;
  stream: MediaStream | null;
  status: PeerStatus;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  timer: number;
}

export interface CallDeps {
  /** Our own participant id; also decides who is polite in a negotiation collision. */
  self(): string | null;
  signal(to: string, data: string): void;
  setPresence(on: boolean, video: boolean, muted: boolean): void;
  onChange(snapshot: CallSnapshot): void;
}

const SPEAKING_ON = 0.045;
const SPEAKING_OFF = 0.025;

export class CallManager {
  readonly peers = new Map<string, Peer>();
  private local: MediaStream | null = null;
  private joined = false;
  private joining = false;
  private muted = false;
  private wantVideo = false;
  private error: string | null = null;
  private blocked = false;
  private disposed = false;

  /** Who should be connected: online participants who say they are in the call. */
  private wanted = new Set<string>();

  private audioCtx: AudioContext | null = null;
  private readonly meters = new Map<string, { node: AnalyserNode; buf: Float32Array<ArrayBuffer>; on: boolean }>();
  private meterTimer = 0;
  private speaking: string[] = [];

  constructor(private readonly deps: CallDeps) {}

  snapshot(): CallSnapshot {
    return {
      joined: this.joined,
      joining: this.joining,
      muted: this.muted,
      video: this.wantVideo,
      local: this.local,
      peers: [...this.peers.values()].map((p) => ({ pid: p.pid, stream: p.stream, status: p.status })),
      speaking: this.speaking,
      error: this.error,
      blocked: this.blocked,
    };
  }

  private emit(): void {
    if (!this.disposed) this.deps.onChange(this.snapshot());
  }

  // ── Joining ────────────────────────────────────────────────────────────────

  async join(withVideo: boolean): Promise<void> {
    if (this.joined || this.joining) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error = "This browser can't open a microphone. Calls need a secure (https) connection.";
      return this.emit();
    }
    this.joining = true;
    this.error = null;
    this.emit();
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: withVideo ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } : false,
      });
    } catch (err) {
      this.joining = false;
      this.error = describeDeviceError(err, withVideo);
      return this.emit();
    }
    if (this.disposed) return this.stopLocal();

    this.joining = false;
    this.joined = true;
    this.muted = false;
    this.wantVideo = withVideo && this.local.getVideoTracks().length > 0;
    this.meter("self", this.local);
    this.deps.setPresence(true, this.wantVideo, this.muted);
    this.sync();
    this.emit();
  }

  leave(): void {
    if (!this.joined && !this.joining) return;
    this.joined = false;
    this.joining = false;
    this.wantVideo = false;
    this.blocked = false;
    for (const pid of [...this.peers.keys()]) this.drop(pid);
    this.stopLocal();
    this.deps.setPresence(false, false, true);
    this.emit();
  }

  setMuted(muted: boolean): void {
    if (!this.joined || this.muted === muted) return;
    this.muted = muted;
    for (const t of this.local?.getAudioTracks() ?? []) t.enabled = !muted;
    this.deps.setPresence(true, this.wantVideo, muted);
    this.emit();
  }

  /** Camera on/off mid-call. Pre-made transceivers mean this never renegotiates. */
  async setVideo(on: boolean): Promise<void> {
    if (!this.joined || this.wantVideo === on) return;
    if (!on) {
      for (const t of this.local?.getVideoTracks() ?? []) {
        t.stop();
        this.local?.removeTrack(t);
      }
      for (const peer of this.peers.values()) void peer.video?.replaceTrack(null);
      this.wantVideo = false;
      this.deps.setPresence(true, false, this.muted);
      return this.emit();
    }
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      });
      const track = cam.getVideoTracks()[0];
      if (!track) throw new Error("no camera track");
      if (!this.joined || this.disposed) {
        track.stop();
        return;
      }
      this.local?.addTrack(track);
      for (const peer of this.peers.values()) void peer.video?.replaceTrack(track);
      this.wantVideo = true;
      this.error = null;
      this.deps.setPresence(true, true, this.muted);
    } catch (err) {
      this.error = describeDeviceError(err, true);
    }
    this.emit();
  }

  // ── Mesh ───────────────────────────────────────────────────────────────────

  /**
   * The room socket came back after the server had already written us off. It cleared our call
   * state and told everyone, so they tore their side down — leaving us "in a call" with nobody.
   * Rebuild from scratch: drop the dead connections and say we are here again.
   */
  resync(): void {
    if (!this.joined) return;
    for (const pid of [...this.peers.keys()]) this.drop(pid);
    this.blocked = false;
    this.deps.setPresence(true, this.wantVideo, this.muted);
    this.sync();
    this.emit();
  }

  /** Told by the session whenever the participant list changes. */
  setPeers(pids: readonly string[]): void {
    this.wanted = new Set(pids.filter((p) => p !== this.deps.self()));
    this.sync();
  }

  private sync(): void {
    let changed = false;
    for (const pid of this.peers.keys()) {
      if (!this.joined || !this.wanted.has(pid)) {
        this.drop(pid);
        changed = true;
      }
    }
    if (this.joined) {
      for (const pid of this.wanted) {
        if (!this.peers.has(pid)) {
          this.open(pid);
          changed = true;
        }
      }
    }
    if (changed) this.emit();
  }

  private open(pid: string): Peer {
    const self = this.deps.self() ?? "";
    const pc = new RTCPeerConnection({ iceServers: [...ICE_SERVERS], bundlePolicy: "max-bundle" });
    const sink = new Audio();
    sink.autoplay = true;
    // Lower id is polite. Only the impolite side ever offers, so the two sides can never
    // create competing sets of m-lines — the glare that leaves a connection half-open.
    const polite = self < pid;

    const peer: Peer = {
      pid,
      pc,
      audio: null,
      video: null,
      sink,
      stream: null,
      status: "connecting",
      polite,
      makingOffer: false,
      ignoreOffer: false,
      timer: window.setTimeout(() => {
        if (peer.status === "connecting") {
          peer.status = "failed";
          this.blocked = true;
          this.emit();
        }
      }, CALL_CONNECT_TIMEOUT_MS),
    };
    this.peers.set(pid, peer);

    // The offering side builds the slots; the answering side adopts whatever the offer brings.
    if (!polite) {
      peer.audio = pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
      peer.video = pc.addTransceiver("video", { direction: "sendrecv" }).sender;
      this.attachLocal(peer);
    }

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) this.send(pid, { description: pc.localDescription.toJSON() });
      } catch {
        /* a failed offer is retried by the next negotiationneeded */
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send(pid, { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      // Tracks arrive via replaceTrack on a pre-made transceiver, which carries no msid — so
      // e.streams is empty and we assemble the stream ourselves. A new MediaStream each time
      // also gives React a changed reference to re-render on.
      const tracks = peer.stream ? peer.stream.getTracks().filter((t) => t !== e.track) : [];
      peer.stream = new MediaStream([...tracks, e.track]);
      sink.srcObject = peer.stream;
      void sink.play().catch(() => {
        /* autoplay can refuse before a gesture; the bubble's own element still plays it */
      });
      if (e.track.kind === "audio") this.meter(pid, peer.stream);
      e.track.onunmute = () => this.emit();
      e.track.onmute = () => this.emit();
      this.emit();
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
        peer.status = "connected";
        clearTimeout(peer.timer);
      } else if (s === "failed") {
        peer.status = "failed";
        this.blocked = true;
      } else if (s === "disconnected") {
        peer.status = "connecting";
      }
      this.emit();
    };
    return peer;
  }

  /** Point this peer's senders at our current microphone and camera. */
  private attachLocal(peer: Peer): void {
    void peer.audio?.replaceTrack(this.local?.getAudioTracks()[0] ?? null);
    void peer.video?.replaceTrack(this.local?.getVideoTracks()[0] ?? null);
  }

  /** Answering side: take the transceivers the offer created and make them two-way. */
  private adoptTransceivers(peer: Peer): void {
    for (const t of peer.pc.getTransceivers()) {
      const kind = t.receiver.track?.kind;
      if (kind === "audio") peer.audio = t.sender;
      else if (kind === "video") peer.video = t.sender;
      else continue;
      if (t.direction !== "sendrecv") t.direction = "sendrecv";
    }
    this.attachLocal(peer);
  }

  private drop(pid: string): void {
    const peer = this.peers.get(pid);
    if (!peer) return;
    clearTimeout(peer.timer);
    peer.pc.onnegotiationneeded = null;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    peer.sink.srcObject = null;
    peer.sink.remove();
    this.unmeter(pid);
    this.peers.delete(pid);
  }

  private send(pid: string, signal: Signal): void {
    this.deps.signal(pid, JSON.stringify(signal));
  }

  /** A signalling frame arrived for us. */
  async onSignal(from: string, raw: string): Promise<void> {
    if (!this.joined) return;
    let signal: Signal;
    try {
      signal = JSON.parse(raw) as Signal;
    } catch {
      return;
    }
    // A peer may reach us a moment before the participant update that announces them.
    const peer = this.peers.get(from) ?? (this.wanted.has(from) ? this.open(from) : undefined);
    if (!peer) return;
    const { pc } = peer;

    try {
      if (signal.description) {
        const offer = signal.description.type === "offer";
        const collision = offer && (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(signal.description);
        if (offer) {
          // Claim the slots the offer created and put our own tracks in them, so the answer
          // goes back sendrecv rather than recvonly.
          this.adoptTransceivers(peer);
          await pc.setLocalDescription();
          if (pc.localDescription) this.send(from, { description: pc.localDescription.toJSON() });
        }
      } else if (signal.candidate) {
        try {
          await pc.addIceCandidate(signal.candidate);
        } catch (err) {
          if (!peer.ignoreOffer) throw err;
        }
      }
    } catch {
      /* One bad frame should not kill the call; ICE retries on its own. */
    }
  }

  // ── Who is talking ─────────────────────────────────────────────────────────

  /**
   * Level metering drives the speaking rings and ducks the movie. It runs on the raw stream
   * rather than the connection stats so it reacts immediately and works for our own mic too.
   */
  private meter(key: string, stream: MediaStream): void {
    if (!stream.getAudioTracks().length) return;
    try {
      this.audioCtx ??= new AudioContext();
      const ctx = this.audioCtx;
      if (ctx.state === "suspended") void ctx.resume();
      const node = ctx.createAnalyser();
      node.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(node);
      this.meters.set(key, { node, buf: new Float32Array(new ArrayBuffer(node.fftSize * 4)), on: false });
      if (!this.meterTimer) this.meterTimer = window.setInterval(() => this.readMeters(), 150);
    } catch {
      /* metering is a nicety — never let it break the call */
    }
  }

  private unmeter(key: string): void {
    this.meters.delete(key);
    if (!this.meters.size && this.meterTimer) {
      clearInterval(this.meterTimer);
      this.meterTimer = 0;
    }
  }

  private readMeters(): void {
    const loud: string[] = [];
    for (const [key, m] of this.meters) {
      m.node.getFloatTimeDomainData(m.buf);
      let sum = 0;
      for (const v of m.buf) sum += v * v;
      const rms = Math.sqrt(sum / m.buf.length);
      // Hysteresis, so a voice at the threshold does not strobe the ring.
      m.on = m.on ? rms > SPEAKING_OFF : rms > SPEAKING_ON;
      if (m.on && !(key === "self" && this.muted)) loud.push(key);
    }
    const changed = loud.length !== this.speaking.length || loud.some((p, i) => p !== this.speaking[i]);
    if (changed) {
      this.speaking = loud;
      this.emit();
    }
  }

  private stopLocal(): void {
    for (const t of this.local?.getTracks() ?? []) t.stop();
    this.local = null;
    this.unmeter("self");
    this.speaking = [];
  }

  dispose(): void {
    this.disposed = true;
    for (const pid of [...this.peers.keys()]) this.drop(pid);
    this.stopLocal();
    if (this.meterTimer) clearInterval(this.meterTimer);
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }
}

function describeDeviceError(err: unknown, video: boolean): string {
  const name = err instanceof DOMException ? err.name : "";
  const device = video ? "camera or microphone" : "microphone";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return `Permission to use your ${device} was blocked. Allow it in your browser's address bar, then try again.`;
    case "NotFoundError":
    case "OverconstrainedError":
      return `No ${device} found on this device.`;
    case "NotReadableError":
      return `Your ${device} is already in use by another app.`;
    default:
      return `Couldn't open your ${device}.`;
  }
}
