const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A 7-day Mon–Sun strip showing which days train (and what) vs rest. `schedule[i]` is the weekday (0–6)
 * assigned to `templates[i]`. When `editable`, each session gets a weekday <select>; reassigning to an
 * occupied weekday swaps the two sessions so the layout stays valid. Reuses the .cal-grid calendar styling.
 */
export default function WeekCalendar({
  templates, schedule, editable = false, onChange,
}: {
  templates: { name: string }[];
  schedule: number[];
  editable?: boolean;
  onChange?: (next: number[]) => void;
}) {
  const templateOn = (wd: number) => schedule.findIndex((s) => s === wd);
  const move = (ti: number, wd: number) => {
    if (!onChange) return;
    const next = schedule.slice();
    const occupant = next.findIndex((s) => s === wd);
    if (occupant >= 0 && occupant !== ti) next[occupant] = next[ti]; // swap rather than collide
    next[ti] = wd;
    onChange(next);
  };

  return (
    <div className="card card-pad" style={{ margin: "12px 0" }}>
      <span className="micro">Weekly schedule · rest days spaced for ≥48h recovery</span>
      <div className="cal-grid" style={{ marginTop: 10 }}>
        {WD.map((label, wd) => {
          const ti = templateOn(wd);
          const training = ti >= 0;
          return (
            <div
              key={wd}
              className={`cal-cell${training ? " has" : ""}`}
              style={{ minHeight: 52, padding: 6, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, cursor: "default", visibility: "visible" }}
            >
              <span className="cal-wd" style={{ position: "static" }}>{label}</span>
              {training
                ? <span className="tag" style={{ fontSize: 9, textAlign: "center" }}>{templates[ti].name}</span>
                : <span className="micro" style={{ opacity: 0.35, fontSize: 9 }}>rest</span>}
            </div>
          );
        })}
      </div>

      {editable && (
        <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
          {templates.map((t, ti) => (
            <div key={ti} className="detail-row" style={{ gap: 8 }}>
              <span className="tag" style={{ fontSize: 9, flexShrink: 0 }}>{t.name}</span>
              <select
                className="input mono grow"
                style={{ padding: "6px 8px", fontSize: 13 }}
                value={schedule[ti]}
                onChange={(e) => move(ti, Number(e.target.value))}
              >
                {WD.map((label, wd) => <option key={wd} value={wd}>{label}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
