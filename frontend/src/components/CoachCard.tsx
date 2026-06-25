import { useQuery } from "@tanstack/react-query";
import { Api } from "../api/client";
import { useSettings } from "../settings";

const PHASE_LABEL: Record<string, string> = { SURPLUS: "Surplus", DEFICIT: "Deficit", MAINTENANCE: "Maintenance", UNKNOWN: "—" };
const PHASE_COLOR: Record<string, string> = { SURPLUS: "var(--volt)", DEFICIT: "#f5b945", MAINTENANCE: "var(--ice)", UNKNOWN: "var(--muted)" };
const kcal = (n: number) => n.toLocaleString();

/** Programmatically open the Settings sidebar by clicking the gear button in the topbar. */
function openSettings() {
  (document.querySelector('button[title="Settings"]') as HTMLButtonElement | null)?.click();
}

/** Layer-2 energy-balance "Coach" card. Read-time estimate, gated + word-confidence. Not medical advice. */
export default function CoachCard() {
  const { setCoachEnabled } = useSettings();
  const energy = useQuery({ queryKey: ["energy"], queryFn: Api.energy });
  const e = energy.data;
  if (!e) return null;

  const ready = e.status === "READY";
  const needsProfile = e.missingProfile.length > 0;
  const hasMaintenance = e.maintenanceKcalLow != null && e.maintenanceKcalHigh != null;
  const sd = e.surplusDeficitKcalLow != null && e.surplusDeficitKcalHigh != null
    ? [Math.min(Math.abs(e.surplusDeficitKcalLow), Math.abs(e.surplusDeficitKcalHigh)),
       Math.max(Math.abs(e.surplusDeficitKcalLow), Math.abs(e.surplusDeficitKcalHigh))]
    : null;

  return (
    <div className="card card-pad coach fade-up">
      <div className="spread">
        <span className="micro">Coach · energy balance</span>
        <div className="row" style={{ gap: 8 }}>
          {ready && <span className="coach-pill" style={{ color: PHASE_COLOR[e.phase], borderColor: PHASE_COLOR[e.phase] }}>{PHASE_LABEL[e.phase]}</span>}
          <button className="icon-btn" title="Hide (re-enable in Settings)" onClick={() => setCoachEnabled(false)}>×</button>
        </div>
      </div>

      {!ready ? (
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
      ) : (
        <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.7 }}>
          <div>Trend <b className="mono" style={{ color: PHASE_COLOR[e.phase] }}>{e.ratePerWeekKg} kg/week</b> — looks like a <b>{PHASE_LABEL[e.phase].toLowerCase()}</b>.</div>
          {e.maintenanceKcalLow != null && (
            <div className="muted">Maintenance ≈ <b className="mono">{kcal(e.maintenanceKcalLow)}–{kcal(e.maintenanceKcalHigh!)}</b> kcal/day</div>
          )}
          {e.phase !== "MAINTENANCE" && sd && (
            <div className="muted">{e.phase === "SURPLUS" ? "Surplus" : "Deficit"} ≈ <b className="mono">{kcal(sd[0])}–{kcal(sd[1])}</b> kcal/day</div>
          )}
          <div className="micro" style={{ marginTop: 4 }}>{e.confidence.toLowerCase()} confidence{needsProfile && " · add your profile for calorie estimates"}</div>
        </div>
      )}

      <p className="micro" style={{ marginTop: 10, color: "var(--faint)" }}>
        Estimated from your weight trend — not medical or nutrition advice.
      </p>
    </div>
  );
}
