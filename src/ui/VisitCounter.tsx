import { formatCount, useVisits } from "../app/visits";
import { cx } from "../lib/cx";

/** Site visit counters, shown as a small HUD readout. Renders nothing until the numbers arrive. */
export function VisitCounter({ className }: { className?: string }) {
  const visits = useVisits();
  if (!visits) return null;
  return (
    <span className={cx("visits", className)}>
      <span className="visits__dot" aria-hidden="true" />
      <span className="visits__item">
        <b className="tnum">{formatCount(visits.today)}</b> today
      </span>
      <span className="visits__sep" aria-hidden="true" />
      <span className="visits__item">
        <b className="tnum">{formatCount(visits.total)}</b> all time
      </span>
      <span className="visually-hidden">
        . {formatCount(visits.today)} visits today, {formatCount(visits.total)} visits in total.
      </span>
    </span>
  );
}
