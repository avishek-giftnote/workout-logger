import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import { useAuth } from "../auth/auth";
import { useSettings } from "../settings";

/** Slide-out settings panel; closes when the backdrop (anywhere outside) is clicked. */
export default function SettingsSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signOut } = useAuth();
  const { prevSource, setPrevSource, showRpe, setShowRpe, restTarget, setRestTarget } = useSettings();
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
          <label>Rest timer target</label>
          <div className="seg" style={{ width: "100%", marginTop: 4 }}>
            {REST_PRESETS.map((p) => (
              <button key={p.v} className={restTarget === p.v ? "on" : ""} style={{ flex: 1, fontSize: 11 }}
                onClick={() => setRestTarget(p.v)}>{p.label}</button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            A rest timer starts when you tick a set ✓; it highlights once the target is reached.
          </p>
        </div>

        <div className="grow" />
        <button className="btn btn-ghost btn-block" onClick={signOut}>Sign out</button>
      </aside>
    </div>
  );
}
