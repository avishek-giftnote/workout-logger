import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import { useAuth } from "../auth/auth";
import { useSettings } from "../settings";
import { EXERCISE_CHARTS, TEMPLATE_CHARTS } from "../charts";

/** Slide-out settings panel; closes when the backdrop (anywhere outside) is clicked. */
export default function SettingsSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signOut } = useAuth();
  const { prevSource, setPrevSource, showRpe, setShowRpe, restTarget, setRestTarget,
    restTimerEnabled, setRestTimerEnabled, charts, toggleChart } = useSettings();
  const strengthCharts = EXERCISE_CHARTS.filter((c) => !c.cardio);
  const cardioCharts = EXERCISE_CHARTS.filter((c) => c.cardio);
  const REST_PRESETS: { v: number; label: string }[] = [
    { v: 0, label: "Off" }, { v: 60, label: "1:00" }, { v: 90, label: "1:30" },
    { v: 120, label: "2:00" }, { v: 180, label: "3:00" },
  ];
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: Api.me, enabled: open });
  const [bw, setBw] = useState("");
  const saveBw = useMutation({
    mutationFn: () => Api.setBodyweight(bw.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); setBw(""); },
  });

  if (!open) return null;

  return (
    <div className="sidebar-backdrop" onClick={onClose}>
      <aside className="sidebar" onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <span className="micro">Settings</span>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>

        <div className="field" style={{ marginTop: 22 }}>
          <label>Bodyweight (kg)</label>
          {me.data?.currentBodyweightKg && (
            <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              Current <b className="mono" style={{ color: "var(--ice)" }}>{me.data.currentBodyweightKg} kg</b> · used for calisthenics
            </p>
          )}
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <input className="input mono grow" inputMode="decimal"
              placeholder={me.data?.currentBodyweightKg ?? "e.g. 72.5"}
              value={bw} onChange={(e) => setBw(e.target.value)} />
            <button className="btn btn-volt" disabled={!bw.trim() || saveBw.isPending}
              onClick={() => saveBw.mutate()}>{saveBw.isPending ? "…" : "Save"}</button>
          </div>
        </div>

        <div className="field" style={{ marginTop: 22 }}>
          <label>Load previous set values from</label>
          <div className="seg" style={{ width: "100%", marginTop: 4 }}>
            <button className={prevSource === "any" ? "on" : ""} style={{ flex: 1 }}
              onClick={() => setPrevSource("any")}>Any workout</button>
            <button className={prevSource === "template" ? "on" : ""} style={{ flex: 1 }}
              onClick={() => setPrevSource("template")}>Same template</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {prevSource === "any"
              ? "Placeholders use the most recent time you did the exercise, in any workout."
              : "Placeholders only use sessions started from the same template."}
          </p>
        </div>

        <div className="field" style={{ marginTop: 22 }}>
          <label>RPE field</label>
          <div className="seg" style={{ width: "100%", marginTop: 4 }}>
            <button className={showRpe ? "on" : ""} style={{ flex: 1 }} onClick={() => setShowRpe(true)}>Show</button>
            <button className={!showRpe ? "on" : ""} style={{ flex: 1 }} onClick={() => setShowRpe(false)}>Hide</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Hiding removes the RPE input while off; previously logged RPE is kept and returns when you show it again.
          </p>
        </div>

        <div className="field" style={{ marginTop: 22 }}>
          <label>Rest timer</label>
          <div className="seg" style={{ width: "100%", marginTop: 4 }}>
            <button className={restTimerEnabled ? "on" : ""} style={{ flex: 1 }} onClick={() => setRestTimerEnabled(true)}>On</button>
            <button className={!restTimerEnabled ? "on" : ""} style={{ flex: 1 }} onClick={() => setRestTimerEnabled(false)}>Off</button>
          </div>
          {restTimerEnabled && (
            <>
              <label style={{ display: "block", marginTop: 12 }}>Default target</label>
              <div className="seg" style={{ width: "100%", marginTop: 4 }}>
                {REST_PRESETS.map((p) => (
                  <button key={p.v} className={restTarget === p.v ? "on" : ""} style={{ flex: 1, fontSize: 11 }}
                    onClick={() => setRestTarget(p.v)}>{p.label}</button>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Starts when you tick a set ✓ and highlights at the target. Exercises can override this default
                from their page; un-ticking a set clears the timer.
              </p>
            </>
          )}
        </div>

        <div className="field" style={{ marginTop: 22 }}>
          <label>Graphs</label>
          <p className="muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>Pick which charts appear on exercise & template pages.</p>
          <span className="micro">Strength exercises</span>
          <div className="chip-wrap" style={{ margin: "6px 0 10px" }}>
            {strengthCharts.map((c) => (
              <button key={c.key} className={`chip-toggle${charts.includes(c.key) ? " on" : ""}`} onClick={() => toggleChart(c.key)}>{c.label}</button>
            ))}
          </div>
          <span className="micro">Cardio exercises</span>
          <div className="chip-wrap" style={{ margin: "6px 0 10px" }}>
            {cardioCharts.map((c) => (
              <button key={c.key} className={`chip-toggle${charts.includes(c.key) ? " on" : ""}`} onClick={() => toggleChart(c.key)}>{c.label}</button>
            ))}
          </div>
          <span className="micro">Templates</span>
          <div className="chip-wrap" style={{ marginTop: 6 }}>
            {TEMPLATE_CHARTS.map((c) => (
              <button key={c.key} className={`chip-toggle${charts.includes(c.key) ? " on" : ""}`} onClick={() => toggleChart(c.key)}>{c.label}</button>
            ))}
          </div>
        </div>

        <div className="grow" />
        <button className="btn btn-ghost btn-block" onClick={signOut}>Sign out</button>
      </aside>
    </div>
  );
}
