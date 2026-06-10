# The Workout Logger council

Reusable specialist subagents convened to deliberate design decisions for Workout Logger. Each `*.md` here is
a Claude Code subagent definition (YAML frontmatter + a system prompt grounded in this project's invariants).

| Agent | Role |
| --- | --- |
| [frontend-engineer](frontend-engineer.md) | React/Vite/TS, the shared logging engine, fast in-gym UX |
| [backend-engineer](backend-engineer.md) | Java/Spring/MongoDB, tenant isolation, Decimal128-as-string |
| [systems-architect](systems-architect.md) | data flow, online/offline boundary, sync, sequencing, risk |
| [data-modeler](data-modeler.md) | document/schema shape, additive nullable fields, stored vs derived |
| [mobile-engineer](mobile-engineer.md) | React Native/Expo + the deferred offline-sync engine |
| [sports-data-expert](sports-data-expert.md) | exercise-science metrics: strength + cardio units, what athletes log |
| [test-user](test-user.md) | QA / real-athlete persona that pressure-tests UX and finds friction |

## How to convene them

- **One expert** — delegate with the Agent tool using `subagent_type` (e.g. `data-modeler`) for a focused
  opinion, or invoke by name in conversation.
- **A full council** — run a Workflow that spawns several in parallel (each via `agentType`), then a second
  round where each reacts to the others' positions before you synthesize. This is how the cardio schema was
  designed. A typical deliberation asks each member for: a concrete recommendation, 2–4 strong opinions each
  with a *why*, and the single biggest risk.

Pick the members that fit the decision — schema work pulls data-modeler + backend + sports-data + test-user;
a UI change pulls frontend + test-user; anything cross-cutting or future-facing adds systems-architect or
mobile-engineer.
