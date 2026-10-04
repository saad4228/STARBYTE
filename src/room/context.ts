import { createContext, useContext } from "react";
import type { RoomSession, SessionState } from "./session";
import { useStore } from "./store";

export const SessionContext = createContext<RoomSession | null>(null);

export function useSession(): RoomSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside a room");
  return session;
}

/** Subscribe to one slice of the room. Selectors must return stable values. */
export function useRoom<T>(selector: (state: SessionState) => T): T {
  return useStore(useSession().store, selector);
}
