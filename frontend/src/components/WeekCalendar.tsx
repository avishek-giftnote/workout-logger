import { useState } from "react";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A 7-day Mon–Sun strip showing which days train (and what) vs rest. `schedule[i]` is the weekday (0–6)
 * assigned to `templates[i]`. When `editable`, tap a training cell to "pick it up", then tap a rest cell
 * to move that session there (swaps on collision). Reuses the .cal-grid calendar styling.
 */
export default function WeekCalendar({
  templates, schedule, editable = false, onChange,
}: {
  templates: { name: string }[];
  schedule: number[];
  editable?: boolean;
  onChange?: (next: number[]) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null); // template index that is "lifted"

  const templateOn = (wd: number) => schedule.findIndex((s) => s === wd);
  const move = (ti: number, wd: number) => {
    if (!onChange) return;
    const next = schedule.slice();
    const occupant = next.findIndex((s) => s === wd);
    if (occupant >= 0 && occupant !== ti) next[occupant] = next[ti]; // swap rather than collide
    next[ti] = wd;
    onChange(next);
  };

  const handleCellTap = (wd: number) => {
    if (!editable) return;
    const ti = templateOn(wd);
    const isTraining = ti >= 0;

    if (picked === null) {
      // Nothing picked yet — only training cells start a pick
      if (isTraining) setPicked(ti);
    } else {
      // Something is already picked
      if (isTraining && ti === picked) {
        // Tap the same cell again → cancel
        setPicked(null);
      } else if (isTraining) {
        // Tap a different training cell → move picked session here (swaps)
        move(picked, wd);
        setPicked(null);
      } else {
        // Tap a rest cell → drop picked session here
        move(picked, wd);
        setPicked(null);
      }
    }
  };

  return (
    <div className="card card-pad" style={{ margin: "12px 0" }}>
      <span className="micro">Weekly schedule · rest days spaced for ≥48h recovery</span>
      {editable && (
        <span
          className="micro"
          style={{ display: "block", marginTop: 4, opacity: picked !== null ? 1 : 0.55 }}
        >
          {picked !== null
            ? `"${templates[picked].name}" picked — tap a rest day to move it, or tap it again to cancel`
            : "Tap a training day to pick it, then tap a rest day to move it"}
        </span>
      )}
      <div className="cal-grid" style={{ marginTop: 10 }}>
        {WD.map((label, wd) => {
          const ti = templateOn(wd);
          const isTraining = ti >= 0;
          const isPicked = editable && isTraining && ti === picked;
          const isDropTarget = editable && picked !== null && !isTraining;

          // Build the outline style for picked / droppable states
          const cellStyle: React.CSSProperties = {
            minHeight: 52,
            padding: 6,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
            cursor: editable ? "pointer" : "default",
            visibility: "visible",
            transition: "outline 0.1s, background 0.1s",
            ...(isPicked
              ? { outline: "2px solid var(--volt)", outlineOffset: "-2px", background: "rgba(205,241,56,0.22)" }
              : isDropTarget
              ? { outline: "1px dashed rgba(205,241,56,0.55)", outlineOffset: "-2px" }
              : {}),
          };

          return (
            <div
              key={wd}
              className={`cal-cell${isTraining ? " has" : ""}`}
              style={cellStyle}
              onClick={() => handleCellTap(wd)}
              role={editable ? "button" : undefined}
              aria-label={
                editable
                  ? isTraining
                    ? `${label}: ${templates[ti].name}${isPicked ? " (picked)" : " — tap to pick"}`
                    : `${label}: rest day${picked !== null ? " — tap to move here" : ""}`
                  : undefined
              }
            >
              <span className="cal-wd" style={{ position: "static" }}>{label}</span>
              {isTraining
                ? <span className="tag" style={{ fontSize: 9, textAlign: "center" }}>{templates[ti].name}</span>
                : <span className="micro" style={{ opacity: 0.35, fontSize: 9 }}>rest</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
