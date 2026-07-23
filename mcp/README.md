# workout-logger-mcp

A **local stdio MCP (Model Context Protocol) server** for Workout Logger. It lets an LLM client
(Claude Desktop, Claude Code) read and change *your* workout data conversationally — "log 3×5 bench
at 80kg", "how's my squat trending", "am I in a surplus".

## Design (why it's built this way)

Three decisions make this a single-user preview that becomes a multi-user remote server by swapping
plumbing, not rewriting:

1. **Rides the REST API, never the DB.** Tools call the same `:8080/api` endpoints the frontend uses,
   so **tenant isolation is inherited for free** (every backend repo ANDs `userId` into every query).
2. **Identity is injected, never hardcoded.** `resolveLocalToken` produces a `getToken()` the whole
   server closes over. Locally it resolves once at startup (login or a pasted JWT). The future remote
   server swaps it for a per-request OAuth token — nothing in the tools changes.
3. **Holds no per-user state.** Because identity rides each call, the process forgets you between
   requests → it's stateless → horizontally scalable. The real load lands on Spring + Mongo, which
   already handle concurrency. That's why local → remote is a transport + auth swap, not a rewrite.

## Run it

```bash
npm install
npm run build
cp .env.example .env.local     # fill in WORKOUT_LOGGER_EMAIL/_PASSWORD (or _TOKEN)
# needs the backend running on :8080 (mvn spring-boot:run) + a Mongo
```

Identity (`.env.local`): set `WORKOUT_LOGGER_EMAIL` + `WORKOUT_LOGGER_PASSWORD` (server logs in at
startup and caches the JWT), or a pre-minted `WORKOUT_LOGGER_TOKEN`. Target via `WORKOUT_LOGGER_API_URL`
(default `http://localhost:8080/api`).

## Use it from Claude Code

Registered in the repo's `.mcp.json` as `workout-logger` (sources `mcp/.env.local`, runs
`mcp/dist/server.js`). After `npm run build` and filling `.env.local`, restart Claude Code and the
tools appear. Also works in Claude Desktop — point its MCP config at `node .../mcp/dist/server.js`
with the same env.

## Commands

- `npm run build` — `tsc` → `dist/`
- `npm test` — vitest (request-building, the decimal-string guard, the identity provider); **no backend needed**
- `npm run smoke` — boots the server over stdio and lists tools; **no backend needed**
- `npm run typecheck` — `tsc --noEmit`

## Tools (21)

**Reads:** `get_profile`, `get_energy_estimate`, `get_active_plan`, `get_plan_history`,
`list_exercises`, `last_working_set`, `list_workouts`, `get_workout`, `list_templates`, `list_splits`.

**Writes:** `log_workout`, `update_workout`, `set_bodyweight`, `update_profile`, `create_plan`,
`advance_plan`, `add_mesocycle`, `create_exercise`, `restore_default_exercises`.

**Destructive** (annotated so the client can confirm first): `delete_workout`, `end_plan`.

Weights/loadDelta are decimal **strings** end-to-end — a zod guard mirroring the backend `@Pattern`
rejects JS numbers before they can round a fractional plate.

> **Trust note:** for training advice, prefer the tools that surface the deterministic engine
> (`get_energy_estimate`, `get_active_plan`) over free-reasoning from raw sets — the engine owns the
> periodization invariants.
