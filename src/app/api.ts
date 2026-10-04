import type { CreateRoomRequest, CreateRoomResponse, RoomInfo } from "../../shared/protocol";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export async function createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
  let res: Response;
  try {
    res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch {
    throw new ApiError("network", "Can't reach STARBYTE right now. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as Partial<CreateRoomResponse> & { error?: string; message?: string };
  if (!res.ok || !body.roomId || !body.hostKey) {
    throw new ApiError(body.error ?? "internal", body.message ?? "Something went wrong creating the room.", res.status);
  }
  return { roomId: body.roomId, hostKey: body.hostKey };
}

export async function fetchRoomInfo(id: string, signal?: AbortSignal): Promise<RoomInfo | null> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(id)}`, { signal, cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError("internal", "Couldn't load this room.", res.status);
  return (await res.json()) as RoomInfo;
}

export function roomSocketUrl(id: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/rooms/${encodeURIComponent(id)}/ws`;
}

export function inviteUrl(id: string): string {
  return `${window.location.origin}/r/${id}`;
}
