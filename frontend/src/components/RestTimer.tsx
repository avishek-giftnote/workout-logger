import { useEffect, useState } from "react";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Count-up rest timer that (re)starts each time `start` changes; highlights at the target. */
export default function RestTimer({ start, target, onDismiss }: {
  start: number | null; target: number; onDismiss: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (start == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [start]);

  if (start == null) return null;
  const elapsed = Math.max(0, Math.floor((now - start) / 1000));
  const reached = target > 0 && elapsed >= target;

  return (
    <div className={`rest-bar${reached ? " reached" : ""}`}>
      <span className="micro">Rest</span>
      <span className="rest-time">{fmt(elapsed)}</span>
      {target > 0 && <span className="rest-target">/ {fmt(target)}</span>}
      <button className="rest-x" title="Dismiss" onClick={onDismiss}>×</button>
    </div>
  );
}
