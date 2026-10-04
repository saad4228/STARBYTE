import { AlertTriangle, Check, Circle, Loader2, X } from "lucide-react";
import type { StepStatus } from "../media/analyze";
import { Badge } from "../ui/Badge";
import { useRoom } from "./context";

/** Connection state as a HUD pill. */
export function ConnPill() {
  const conn = useRoom((s) => s.conn);
  if (conn.status === "open") {
    return (
      <Badge tone="ok" title="Connected to the room">
        Online{conn.rtt !== null ? ` · ${Math.round(conn.rtt)}ms` : ""}
      </Badge>
    );
  }
  if (conn.trouble) {
    return (
      <Badge tone="danger" ring title={conn.trouble}>
        Can't connect
      </Badge>
    );
  }
  if (conn.status === "reconnecting") {
    return (
      <Badge tone="warn" ring pulse>
        Reconnecting{conn.attempt > 1 ? ` · ${Math.min(conn.attempt, 99)}` : ""}
      </Badge>
    );
  }
  return (
    <Badge tone="muted" ring pulse>
      Connecting
    </Badge>
  );
}

export function StepIcon({ status }: { status: StepStatus | "active" }) {
  switch (status) {
    case "ok":
      return <Check size={16} strokeWidth={3} aria-label="done" />;
    case "warn":
      return <AlertTriangle size={16} strokeWidth={2.5} aria-label="warning" />;
    case "fail":
      return <X size={16} strokeWidth={3} aria-label="failed" />;
    case "active":
      return <Loader2 size={16} className="spin" aria-label="in progress" />;
    default:
      return <Circle size={10} aria-label="pending" />;
  }
}
