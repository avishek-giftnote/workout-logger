import { useQuery } from "@tanstack/react-query";
import { Api } from "../api/client";
import { useSettings } from "../settings";

const PHASE_LABEL: Record<string, string> = { SURPLUS: "Surplus", DEFICIT: "Deficit", MAINTENANCE: "Maintenance", UNKNOWN: "—" };
const PHASE_COLOR: Record<string, string> = { SURPLUS: "var(--volt)", DEFICIT: "#f5b945", MAINTENANCE: "var(--ice)", UNKNOWN: "var(--muted)" };
const kcal = (n: number) => n.toLocaleString();
/** A kcal range, collapsed to a single value when both bounds round to the same 50-kcal bucket (a tight CI). */
const kcalRange = (lo: number, hi: number) => (lo === hi ? kcal(lo) : `${kcal(lo)}–${kcal(hi)}`);

/** Programmatically open the Settings sidebar by clicking the gear button in the topbar. */
function openSettings() {
  (document.querySelector('button[title="Settings"]') as HTMLButtonElement | null)?.click();
}

/** Layer-2 energy-balance "Coach" card. Read-time estimate on the 5-level ladder (INSUFFICIENT_DATA →
 *  TREND_ONLY → PHASE_LOW/MEDIUM/HIGH), gated + word-confidence. Not medical advice. */
export default function CoachCard() {
  const { setCoachEnabled } = useSettings();
  const energy = useQuery({ queryKey: ["energy"], queryFn: Api.energy });
  const e = energy.data;
  if (!e) return null;

  const decisive = e.status.startsWith("PHASE_");   // a real phase verdict
  const trendOnly = e.status === "TREND_ONLY";      // a trend, but too noisy to call a phase
  const needsProfile = e.missingProfile.length > 0;
  const hasMaintenance = e.maintenanceKcalLow != null && e.maintenanceKcalHigh != null;
  const sd = e.surplusDeficitKcalLow != null && e.surplusDeficitKcalHigh != null
    ? [Math.min(Math.abs(e.surplusDeficitKcalLow), Math.abs(e.surplusDeficitKcalHigh)),
       Math.max(Math.abs(e.surplusDeficitKcalLow), Math.abs(e.surplusDeficitKcalHigh))]
    : null;

  // Display-only training-energy line — flagged as potentially overlapping the activity multiplier (the
  // council kept PAL un-rescaled and made the overlap transparent rather than guessing a split).
  const workoutLine = e.workoutKcal != null ? (
    <div className="micro" style={{ marginTop: 4, color: "var(--faint)" }}>
      Training ≈ <b className="mono">{kcal(e.workoutKcal)}</b> kcal/day on top — rough, and may overlap your activity level.
    </div>
  ) : null;

  const maintenanceLine = hasMaintenance ? (
    <div className="muted">Maintenance ≈ <b className="mono">{kcal(e.maintenanceKcalLow!)}–{kcal(e.maintenanceKcalHigh!)}</b> kcal/day</div>
  ) : null;

  return (
    <div className="card card-pad coach fade-up">
      <div className="spread">
        <span className="micro">Coach · energy balance</span>
        <div className="row" style={{ gap: 8 }}>
          {decisive && <span className="coach-pill" style={{ color: PHASE_COLOR[e.phase], borderColor: PHASE_COLOR[e.phase] }}>{PHASE_LABEL[e.phase]}</span>}
          <button className="icon-btn" title="Hide (re-enable in Settings)" onClick={() => setCoachEnabled(false)}>×</button>
        </div>
      </div>

      {decisive ? (
        <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.7 }}>
          <div>Trend <b className="mono" style={{ color: PHASE_COLOR[e.phase] }}>{e.ratePerWeekKg} kg/week</b> — looks like a <b>{PHASE_LABEL[e.phase].toLowerCase()}</b>.</div>
          {maintenanceLine}
          {e.phase !== "MAINTENANCE" && sd && (
            <div className="muted">{e.phase === "SURPLUS" ? "Surplus" : "Deficit"} ≈ <b className="mono">{kcalRange(sd[0], sd[1])}</b> kcal/day</div>
          )}
          {workoutLine}
          <div className="micro" style={{ marginTop: 4 }}>{e.confidence.toLowerCase()} confidence{needsProfile && " · add your profile for calorie estimates"}</div>
        </div>
      ) : trendOnly ? (
        <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.7 }}>
          <div>Trend <b className="mono">{e.ratePerWeekKg} kg/week</b> — still too noisy to call a phase.</div>
          {maintenanceLine}
          {workoutLine}
          <div className="micro" style={{ marginTop: 4 }}>Keep logging weigh-ins to firm it up.</div>
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 14 }}>
          <p style={{ margin: 0 }}>
            Gathering data — <b className="mono">{e.weighIns}/{e.minWeighIns}</b> weigh-ins over{" "}
            <b className="mono">{e.spanDays}/{e.minSpanDays}</b> days.{" "}
            A trend needs ~2 weeks of weigh-ins to be reliable.
          </p>
          {hasMaintenance && (
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Est. maintenance ≈ <b className="mono">{kcal(e.maintenanceKcalLow!)}–{kcal(e.maintenanceKcalHigh!)}</b> kcal/day
            </p>
          )}
          {workoutLine}
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn btn-volt" style={{ fontSize: 13, padding: "5px 14px" }} onClick={openSettings}>
              Log weight
            </button>
            {needsProfile && (
              <button className="btn btn-ghost" style={{ fontSize: 13, padding: "5px 14px" }} onClick={openSettings}>
                Complete profile
              </button>
            )}
          </div>
        </div>
      )}

      <p className="micro" style={{ marginTop: 10, color: "var(--faint)" }}>
        Estimated from your weight trend — not medical or nutrition advice.
      </p>
    </div>
  );
}
