---
description: Convene the specialist council to review a design decision before building.
---

Convene the Workout Logger council to deliberate the decision in `$ARGUMENTS` before any code is written. Follow `.claude/agents/README.md`.

1. **Pick the members** that fit the decision (don't convene all 7 by default):
   - schema / data-shape → `data-modeler` + `backend-engineer` + `sports-data-expert` + `test-user`
   - UI / UX → `frontend-engineer` + `test-user`
   - cross-cutting or future-facing → add `systems-architect` and/or `mobile-engineer`
2. **Round 1 — independent positions (in parallel).** Spawn the chosen specialists concurrently via the Agent tool (`subagent_type`). Ask each for: one concrete recommendation, 2–4 strong opinions each with a *why*, and the single biggest risk. Keep each return tight — conclusions, not raw research.
3. **Round 2 — cross-examination.** Give each member the others' positions and have them react: what they concede, what they still contest, any newly-surfaced risk.
4. **Synthesize.** Produce a single decision: the recommendation, the trade-offs, the dissent worth recording, and **the invariants this implies** — then (per the workflow rules) note which of those invariants must become tests in the implementing change.

Do not start implementing until the synthesis is presented.
