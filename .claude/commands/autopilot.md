---
description: Autonomous feature/bug delivery — from a one-line request, a council DECIDES the design (no asking), then guard-first → implement → gate → a review council oversees correctness → loop until green. Reaches decisions instead of deferring them; surfaces to the user only for the three named exceptions.
---

Deliver the feature or fix described in `$ARGUMENTS` end-to-end, autonomously. This composes the
project's existing rituals (`/council`, `/gate`, `/pursue`) into one loop and flips the council from
recommend-only to **deciding**: its synthesis is the call, and you proceed on it.

## The autonomy contract (read first — this is the whole point)

**Decide, don't ask.** On technical and design choices, the council's synthesis is authoritative and you
act on it. Do **not** bounce the decision back to the user. Surface to the user ONLY for:

1. **Product/scope ambiguity** you genuinely cannot infer from the request + the codebase — i.e. *what
   the feature should do*, not *how to build it*. Infer aggressively from `DESIGN.md`, `docs/coach.md`,
   existing patterns, and the invariants before deciding it's ambiguous.
2. **Destructive / irreversible / outward-facing acts** — data loss, secrets, a deploy, a force-push, a
   schema change that isn't additive-nullable. (An additive-nullable field is not destructive — decide it.)
3. **Honest deadlock** — the council cannot converge, or the gates cannot pass without weakening a check.
   Report the blocker; never fake a pass, never `--no-verify`, never delete/skip a test to go green.

Everything else: run the councils, build, test, loop, and report the outcome.

## Phase 0 — Intake & sharpen

Restate `$ARGUMENTS` as a concrete objective and a **done-checklist** (machine-checkable items, per the
`/pursue` contract — a failing test / `R##` eval guard for every behavioural criterion; a `curl` /
`ApiIntegrationTest` case for endpoints; a Playwright assertion or described observable for UI). Note
which project invariants the change touches (tenant isolation, Decimal128-as-string, additive-nullable,
data-sufficiency gates). If Phase-0 hits a Contract-#1 product ambiguity, that is the one time you stop
here and ask; otherwise proceed.

## Phase 1 — Decide (autonomous council)

Convene a **deciding council** on the design question the request implies. Use a `Workflow` (the sync
council `docs/sync-architecture-council.md` is the template): pick 3-5 relevant specialists from
`.claude/agents/` by domain (embed each persona as title + lens in the prompt — do **not** pass
`agentType`, per `agents/README.md`); Round 1 independent positions (schema-forced), Round 2
cross-examination, then an Opus synthesis. Two rounds when stakes/disagreement are high, one when the
call is narrow. The synthesis must output: **the decision**, the **invariants it implies**, and which of
those must become tests. This replaces `/council`'s "present, don't act" — you own the decision now.

Skip the council only for a truly mechanical fix (typo, obvious null-guard, a one-line regression with an
existing test). When in doubt, convene it — it is cheap fan-out and keeps the main context clean.

## Phase 2 — Guard-first

Encode each invariant from the decision as a **failing test / `R##`|`S##`|`L##` eval guard first**, before
implementing (the project's *decision → executable guard, same change* rule). These failing guards are the
loop's terminator.

## Phase 3-4 — Implement & gate (delegate to `/pursue`)

Run the `/pursue` loop on the done-checklist: smallest change toward the next unmet check → the
**relevant** gate (`tsc --noEmit` + `npm test`; `npm run eval` if you touched `periodization.ts` /
`prescription.ts` / logging engine / `EnergyService`; `npm run build` before done; backend `mvn test`, and
`RUN_MONGO_TESTS=1 mvn test` against an **isolated** test DB if you touched an endpoint/DTO/repo/domain) →
fix → repeat. For any UI change, **verify live** with the Playwright MCP (the project forbids claiming a UI
change done unwatched). Then run the full `/gate` once for the record.

## Phase 5 — Review council (oversight)

After the gate is green, convene a **review council** — the specialists overseeing that the change
functions as intended. Single-round parallel is usually enough: give each relevant specialist (always
include `eval-engineer` + `test-user`; add the domain owners) the diff + the done-checklist and have them
**adversarially verify** — try to break it, name missed edge cases, regressions, invariant violations, and
whether it actually does what the request asked. Force a structured verdict per member (real issue? / clean?).
Dedupe; keep only confirmed issues.

## Phase 6 — Loop to done

- Review found confirmed issues → treat each as a new done-checklist item, return to Phase 2/3 (guard it,
  fix it), re-gate, re-review. Iterate.
- **Converged** = gates green **AND** review clean **AND** every done-checklist item ✓. Only then is it done.
- Honest exit: on an iteration cap (default 6 across the whole autopilot run) or a genuine blocker, stop and
  report exactly which checks pass, which don't, and why. A partial truthful result beats a faked pass.

## Phase 7 — Record & (optionally) ship

Update `PROGRESS.md` (Done / agenda / decisions) and write the council's decision to auto-memory so it
persists. Regenerate `DIAGRAMS.pdf` if `DIAGRAMS.md` changed. Commit only if asked; if asked, ship via
`/git-ship` (branch → PR → squash-merge — never push to `main`).

## Report

End with: the request, each done-checklist item ✓/✗, the council decision (one line + named dissent if
any), the guards added, the final gate result, what the review council confirmed, and what was verified
live. Name anything deferred and the recommended next step.

---

**Composition:** `/loop /autopilot <request>` runs this self-paced across turns for a large feature (the
runtime re-invokes until the checklist is green or you stop it); `/autopilot <request>` alone runs the
bounded pipeline in one turn. For "fix every instance of X until none remain", prefer a `Workflow`
loop-until-dry over this command.
