import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import { useAuth } from "../auth/auth";
import { useSettings } from "../settings";
import { EXERCISE_CHARTS, TEMPLATE_CHARTS } from "../charts";
import { TrendChart } from "./Chart";
import type { ActivityLevel, BodyweightEntryDto, Goal, Sex } from "../api/types";

const SEX_OPTS: { v: Sex; label: string }[] = [{ v: "MALE", label: "Male" }, { v: "FEMALE", label: "Female" }, { v: "UNSPECIFIED", label: "—" }];
const GOAL_OPTS: { v: Goal; label: string }[] = [{ v: "GAIN_MUSCLE", label: "Gain muscle" }, { v: "LOSE_FAT", label: "Lose fat" }, { v: "MAINTAIN", label: "Maintain" }, { v: "GAIN_STRENGTH", label: "Strength" }];
const ACTIVITY_OPTS: { v: ActivityLevel; label: string }[] = [{ v: "SEDENTARY", label: "Sedentary" }, { v: "LIGHT", label: "Light" }, { v: "MODERATE", label: "Moderate" }, { v: "ACTIVE", label: "Active" }, { v: "VERY_ACTIVE", label: "Very active" }];

/** Slide-out settings panel; closes when the backdrop (anywhere outside) is clicked. */
export default function SettingsSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signOut } = useAuth();
  const { prevSource, setPrevSource, showRpe, setShowRpe, restTarget, setRestTarget,
    restTimerEnabled, setRestTimerEnabled, charts, toggleChart, coachEnabled, setCoachEnabled } = useSettings();
  const strengthCharts = EXERCISE_CHARTS.filter((c) => !c.cardio);
  const cardioCharts = EXERCISE_CHARTS.filter((c) => c.cardio);
  const REST_PRESETS: { v: number; label: string }[] = [
    { v: 0, label: "Off" }, { v: 60, label: "1:00" }, { v: 90, label: "1:30" },
    { v: 120, label: "2:00" }, { v: 180, label: "3:00" },
  ];
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: Api.me, enabled: open });
  const todayIso = new Date().toISOString().slice(0, 10);
  const [bw, setBw] = useState("");
  const [bwDate, setBwDate] = useState(todayIso);
  const saveBw = useMutation({
    mutationFn: () => Api.setBodyweight(bw.trim(), bwDate && bwDate !== todayIso ? bwDate : undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); setBw(""); setBwDate(todayIso); },
  });

  const p = me.data?.profile;
  const saveProfile = useMutation({
    mutationFn: Api.updateProfile,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  const [dob, setDob] = useState("");
  const [height, setHeight] = useState("");
  const [kcal, setKcal] = useState("");
  useEffect(() => {
    setDob(p?.dateOfBirth ?? "");
    setHeight(p?.heightCm ?? "");
    setKcal(p?.initialIntakeKcal != null ? String(p.initialIntakeKcal) : "");
  }, [p?.dateOfBirth, p?.heightCm, p?.initialIntakeKcal]);
  const realWeights = (me.data?.bodyweightLog ?? [])
    .filter((e) => !e.estimated && e.weightKg)
    .map((e) => ({ label: e.recordedAt, value: parseFloat(e.weightKg!) }));

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
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <input className="input mono grow" type="date" max={todayIso}
              value={bwDate} onChange={(e) => setBwDate(e.target.value)} />
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            {bwDate === todayIso ? "Logs today; pick an earlier date to backdate a weigh-in." : `Backdating to ${bwDate}.`}
          </p>
        </div>

        {realWeights.length >= 2 && (
          <div style={{ marginTop: 14 }}>
            <span className="micro">Weight trend · {realWeights.length} weigh-ins</span>
            <div className="mt"><TrendChart points={realWeights} color="var(--ice)" height={78} /></div>
          </div>
        )}

        {(me.data?.bodyweightLog?.length ?? 0) > 0 && (
          <div className="field" style={{ marginTop: 16 }}>
            <label>Weigh-in history</label>
            <p className="muted" style={{ fontSize: 11, margin: "2px 0 8px" }}>Edit a date or weight, or delete an entry.</p>
            <div className="weighin-list">
              {[...(me.data?.bodyweightLog ?? [])]
                .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
                .map((e) => <WeighInRow key={e.id} entry={e} maxDate={todayIso} />)}
            </div>
          </div>
        )}

        <div className="field" style={{ marginTop: 22 }}>
          <label>About you & goals</label>
          <p className="muted" style={{ fontSize: 12, margin: "2px 0 10px" }}>
            Used to estimate your energy balance over time (see the Coach design). Not medical advice.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <div className="grow">
              <span className="micro">Date of birth</span>
              <input type="date" className="input mono" style={{ marginTop: 4 }} value={dob}
                onChange={(e) => { setDob(e.target.value); saveProfile.mutate({ dateOfBirth: e.target.value || null }); }} />
            </div>
            <div style={{ width: 96 }}>
              <span className="micro">Height cm</span>
              <input className="input mono" style={{ marginTop: 4, width: "100%" }} inputMode="decimal" placeholder="164"
                value={height} onChange={(e) => setHeight(e.target.value)}
                onBlur={() => saveProfile.mutate({ heightCm: height.trim() || null })} />
            </div>
          </div>

          <span className="micro" style={{ display: "block", marginTop: 14 }}>Sex</span>
          <div className="seg" style={{ width: "100%", marginTop: 4 }}>
            {SEX_OPTS.map((o) => (
              <button key={o.v} className={p?.sex === o.v ? "on" : ""} style={{ flex: 1 }}
                onClick={() => saveProfile.mutate({ sex: o.v })}>{o.label}</button>
            ))}
          </div>

          <span className="micro" style={{ display: "block", marginTop: 14 }}>Training goal</span>
          <div className="chip-wrap" style={{ marginTop: 6 }}>
            {GOAL_OPTS.map((o) => (
              <button key={o.v} className={`chip-toggle${p?.goal === o.v ? " on" : ""}`}
                onClick={() => saveProfile.mutate({ goal: o.v })}>{o.label}</button>
            ))}
          </div>

          <span className="micro" style={{ display: "block", marginTop: 14 }}>Activity outside workouts</span>
          <div className="chip-wrap" style={{ marginTop: 6 }}>
            {ACTIVITY_OPTS.map((o) => (
              <button key={o.v} className={`chip-toggle${p?.activityLevel === o.v ? " on" : ""}`}
                onClick={() => saveProfile.mutate({ activityLevel: o.v })}>{o.label}</button>
            ))}
          </div>

          <span className="micro" style={{ display: "block", marginTop: 14 }}>Daily calories (enter once)</span>
          <input className="input mono" style={{ marginTop: 4 }} inputMode="numeric" placeholder="e.g. 2400"
            value={kcal} onChange={(e) => setKcal(e.target.value)}
            onBlur={() => { const n = parseInt(kcal, 10); saveProfile.mutate({ initialIntakeKcal: isNaN(n) ? null : n }); }} />
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            A rough current intake — a one-time starting point. The app infers the rest from your weight trend.
          </p>
        </div>

        <div className="field" style={{ marginTop: 22 }}>
          <label>Coach (energy estimate)</label>
          <div className="seg" style={{ width: "100%", marginTop: 4 }}>
            <button className={coachEnabled ? "on" : ""} style={{ flex: 1 }} onClick={() => setCoachEnabled(true)}>On</button>
            <button className={!coachEnabled ? "on" : ""} style={{ flex: 1 }} onClick={() => setCoachEnabled(false)}>Off</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            A surplus/deficit/maintenance estimate from your weight trend, shown on the Training Log. Not medical advice.
          </p>
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

/** One amendable/deletable weigh-in row (date + weight, persisted on blur). */
function WeighInRow({ entry, maxDate }: { entry: BodyweightEntryDto; maxDate: string }) {
  const qc = useQueryClient();
  const day = entry.recordedAt.slice(0, 10);
  const [w, setW] = useState(entry.weightKg ?? "");
  const [d, setD] = useState(day);
  useEffect(() => { setW(entry.weightKg ?? ""); setD(entry.recordedAt.slice(0, 10)); }, [entry.weightKg, entry.recordedAt]);

  const ok = () => qc.invalidateQueries({ queryKey: ["me"] });
  const amend = useMutation({ mutationFn: (patch: { weightKg?: string; recordedAt?: string }) => Api.updateBodyweightEntry(entry.id, patch), onSuccess: ok });
  const remove = useMutation({ mutationFn: () => Api.deleteBodyweightEntry(entry.id), onSuccess: ok });

  return (
    <div className="weighin-row">
      <input className="input mono" type="date" max={maxDate} value={d}
        onChange={(e) => setD(e.target.value)}
        onBlur={() => { if (d && d !== day) amend.mutate({ recordedAt: d }); }} />
      <input className="input mono" inputMode="decimal" style={{ width: 62 }} value={w}
        onChange={(e) => setW(e.target.value)}
        onBlur={() => { const v = w.trim(); if (v && v !== entry.weightKg) amend.mutate({ weightKg: v }); else if (!v) setW(entry.weightKg ?? ""); }} />
      {entry.estimated && <span className="tag" style={{ fontSize: 9 }}>est</span>}
      <button className="icon-btn" title="Delete weigh-in" disabled={remove.isPending}
        onClick={() => remove.mutate()}>×</button>
    </div>
  );
}
