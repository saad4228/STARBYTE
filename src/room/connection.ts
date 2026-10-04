import { TIMING } from "../../shared/constants";
import { FATAL_CLOSE_CODES, HEARTBEAT, type ClientMessage, type ServerMessage } from "../../shared/protocol";

export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface ConnectionEvents {
  onOpen(): void;
  onMessage(msg: ServerMessage): void;
  onStatus(status: ConnStatus, attempt: number): void;
  onFatal(code: number, reason: string): void;
  /** A connection that has never succeeded, with the reason worked out. Null once it recovers. */
  onTrouble(detail: string | null): void;
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
const LATE_RETRY_MS = 15_000;
const DEAD_AFTER_MS = 10_000;

/**
 * The room socket. Reconnects with jittered backoff, detects dead connections with a heartbeat
 * the server answers without waking up, and never gives up unless the room says it's over.
 */
export class RoomConnection {
  status: ConnStatus = "connecting";
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer = 0;
  private beatTimer = 0;
  private deadTimer = 0;
  private stopped = false;
  /** A socket that has worked once is a different problem from one that never has. */
  private everOpened = false;
  private diagnosing = false;

  constructor(
    private readonly url: string,
    private readonly events: ConnectionEvents,
  ) {}

  private readonly onOnline = () => this.reconnectNow();

  connect(): void {
    this.stopped = false;
    window.addEventListener("online", this.onOnline);
    this.open();
  }

  send(msg: ClientMessage): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  /** Skip the backoff, e.g. when the network comes back or the tab wakes up. */
  reconnectNow(): void {
    if (this.stopped || this.ws?.readyState === WebSocket.OPEN) return;
    clearTimeout(this.retryTimer);
    this.discard();
    this.open();
  }

  /** Verify the connection is still alive right now (after sleep / tab switch). */
  probe(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.beat();
    else this.reconnectNow();
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.stopHeartbeat();
    window.removeEventListener("online", this.onOnline);
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, "bye");
    this.setStatus("closed");
  }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      if (!this.everOpened) {
        this.everOpened = true;
        this.events.onTrouble(null);
      }
      this.setStatus("open");
      this.startHeartbeat();
      this.events.onOpen();
    };
    ws.onmessage = (e: MessageEvent<string>) => {
      if (this.ws !== ws) return;
      clearTimeout(this.deadTimer); // any traffic proves the link is alive
      if (e.data === HEARTBEAT) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data) as ServerMessage;
      } catch {
        return;
      }
      this.events.onMessage(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      if (this.stopped) return;
      if (FATAL_CLOSE_CODES.has(e.code)) {
        this.stopped = true;
        this.setStatus("closed");
        this.events.onFatal(e.code, e.reason);
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    this.attempt++;
    this.setStatus("reconnecting");
    // A socket that has never opened will usually never open — a blocked upgrade or a refused
    // origin looks exactly like a flaky network from here, so find out which and say so rather
    // than spinning on "Reconnecting…" forever.
    if (!this.everOpened && this.attempt >= 3 && !this.diagnosing) void this.diagnose();
    const base = BACKOFF_MS[this.attempt - 1] ?? LATE_RETRY_MS;
    this.retryTimer = window.setTimeout(() => this.open(), base * (0.8 + Math.random() * 0.4));
  }

  /** Ask the same endpoint over plain HTTP; the status code names the real problem. */
  private async diagnose(): Promise<void> {
    this.diagnosing = true;
    const probe = this.url.replace(/^ws/, "http");
    let detail: string;
    try {
      const res = await fetch(probe, { headers: { accept: "application/json" } });
      const body = (await res.json().catch(() => null)) as { host?: string } | null;
      if (res.status === 404) {
        detail = "This room no longer exists. Rooms are deleted after a day with nobody in them.";
      } else if (res.status === 429) {
        detail = "Too many attempts from this network. Wait a minute and try again.";
      } else if (res.status === 403 || (body?.host && body.host !== window.location.host)) {
        // The server was addressed as something other than what the browser thinks it is, so
        // every request looks cross-origin to it and the socket is refused.
        detail = `The room is being reached through a proxy or tunnel that rewrites the address (it sees "${body?.host ?? "a different host"}", you see "${window.location.host}"). Open the room on the address the server actually serves.`;
      } else {
        detail =
          "The room is reachable but the realtime connection isn't getting through. Something between you and it — a VPN, a corporate proxy, or a captive portal — is blocking WebSockets.";
      }
    } catch {
      detail = "Can't reach the room server at all. Check the connection, then reload.";
    }
    if (!this.stopped && !this.everOpened) this.events.onTrouble(detail);
    this.diagnosing = false;
  }

  private discard(): void {
    const ws = this.ws;
    this.ws = null;
    this.stopHeartbeat();
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = null;
    try {
      ws.close();
    } catch {
      // already closed
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.beatTimer = window.setInterval(() => this.beat(), TIMING.heartbeatMs);
  }

  private beat(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(HEARTBEAT);
    clearTimeout(this.deadTimer);
    this.deadTimer = window.setTimeout(() => {
      if (this.ws !== ws || this.stopped) return;
      // No answer: the link is dead even if the browser hasn't noticed yet.
      this.discard();
      this.scheduleRetry();
    }, DEAD_AFTER_MS);
  }

  private stopHeartbeat(): void {
    clearInterval(this.beatTimer);
    clearTimeout(this.deadTimer);
  }

  private setStatus(status: ConnStatus): void {
    this.status = status;
    this.events.onStatus(status, this.attempt);
  }
}
