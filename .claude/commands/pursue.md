---
description: Pursue a goal autonomously — encode it as objective checks, then loop implement→gate→verify until every check is green (or an iteration cap is hit). Honest exit only.
---

Pursue the goal in `$ARGUMENTS` to completion by looping until it is **objectively achieved**, not
until it "looks done". This project has strong machine-checkable gates — use them as the loop's
terminator. Never fake success, never weaken a check to pass it.

## 1. Define "done" as objective checks (do this BEFORE writing code)

Restate the goal as a concrete **done-checklist** where each item is something a machine or a watched
run can verify. Follow the project's *decision → executable guard, same change* rule:

- For any behavioural/logic criterion → write a **failing test or eval `R##` guard first**
  (backend JUnit / `ApiIntegrationTest`; frontend Vitest `*.test.ts` / `*.eval.test.ts`). The loop is
  done when these go green.
- For an endpoint/data criterion → a `curl` assertion or `ApiIntegrationTest` case (tenant isolation,
  decimals-as-strings, additive-nullable, data-sufficiency gate — the project invariants).
- For a UI/UX criterion that can't be a unit test → a concrete **Playwright** assertion or a described
  observable (what must render) to confirm live.

If the goal is underspecified or hides a design decision, **stop and surface it** (or convene
`/council` for a cross-cutting design) before looping — don't guess and grind.

## 2. Plan

For anything spanning backend+frontend or several modules, plan first (plan mode) and get the shape
right before the loop starts. Delegate heavy exploration to sub-agents so the main context stays clean.

## 3. Loop (hard cap: 6 iterations unless told otherwise)

Repeat until the done-checklist is all green:

1. Make the **smallest** change toward the next unmet check.
2. Run the **relevant** gate (don't run more than the change needs, don't run less than it touches):
   - Frontend: `npx tsc --noEmit` + `npm test`; add `npm run eval` if you touched
     `periodization.ts` / `prescription.ts` / the logging engine / `EnergyService`; `npm run build` before declaring done.
   - Backend: `mvn test`; add `RUN_MONGO_TESTS=1 mvn test` if you touched an endpoint, DTO, repo, or
     domain (point `MONGODB_TEST_URI` at an **isolated** test DB — never production).
   - UI change: **verify live** in the running app (Playwright MCP) — the project rule forbids claiming a
     UI change done unwatched.
3. Read the failures and fix them. Re-evaluate the done-checklist.
4. **Converged?** All checks green → go to step 4 (Report, success).
   **Cap reached or stuck?** Stop. Report exactly which checks pass and which don't, and why — an honest
   partial result, never a faked pass and never `--no-verify` / a deleted test.

Guardrails inside the loop:
- Never make a check pass by weakening, deleting, or skipping it.
- If two iterations make no progress on the same check, stop and report the blocker (likely a missing
  decision, missing data, or a wrong assumption) instead of spinning.
- Don't commit unless explicitly asked; if asked, ship via `/git-ship`.

## 4. Report

End with: the goal, each done-checklist item with ✓/✗, the tests/guards added, the final gate result,
and what was verified live. If partial, say plainly what remains and the recommended next step.

---

**Composition:** `/loop /pursue <goal>` runs this self-paced across turns (the runtime re-invokes until
you stop it); `/pursue <goal>` alone runs the bounded loop in one turn. For open-ended "fix every X
until none remain", prefer a `Workflow` loop-until-dry instead of this command.
