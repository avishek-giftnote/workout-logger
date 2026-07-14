# Atlas MCP: MongoDB MCP Server for workout-logger

Gives a Claude Code agent direct read-only access to the `workoutlogger` Atlas cluster — no more
inferring IP-access-list blocks from 30-second timeouts, and no manual mongosh sessions to verify
tenant isolation, Decimal128 storage, or importer counts.

Two capabilities in one server:
- **DB inspection** — query `workouts`, `users`, `exercises` etc. to verify invariants live.
- **Atlas admin** (optional) — list access-list entries, cluster state, and project settings via the
  Atlas Admin API. Needs separate API keys (see below); the DB connection alone works without them.

---

## `.mcp.json` block

Add this under `mcpServers` in the project `.mcp.json`:

```json
"mongodb": {
  "command": "bash",
  "args": [
    "-c",
    "[ -f ./backend/.env.local ] && . ./backend/.env.local; export MDB_MCP_CONNECTION_STRING=\"$MONGODB_URI\"; exec npx -y mongodb-mcp-server@latest"
  ],
  "env": { "MDB_MCP_READ_ONLY": "true" }
}
```

The `bash -c` wrapper sources the gitignored `backend/.env.local` so the connection string comes from
`MONGODB_URI` there (rather than a committed `${MONGODB_URI}` reference Claude Code would flag as unset).
`MDB_MCP_READ_ONLY=true` drops all write tools before the server registers them — they never appear
to the client. This DB-only default needs just one env var (`MONGODB_URI`). **Don't reference env vars
you haven't set** — Claude Code flags `${VAR}` references with no value as "Missing environment
variables", and an unresolved connection string makes the server start as `✘ failed`.

### Add Atlas admin (optional — access-list / cluster ops)

Only after you've created the API keys (below), add these two lines back to the `env` block:

```json
"MDB_MCP_API_CLIENT_ID": "${MDB_MCP_API_CLIENT_ID}",
"MDB_MCP_API_CLIENT_SECRET": "${MDB_MCP_API_CLIENT_SECRET}"
```

---

## Env / secret setup

Create `backend/.env.local` (already in `.gitignore` — confirm before committing anything nearby):

```
# MongoDB Atlas connection string — same value as the backend's MONGODB_URI
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.s1wclyw.mongodb.net/workoutlogger?retryWrites=true&w=majority

# Atlas Admin API keys (optional — needed for access-list / cluster ops)
MDB_MCP_API_CLIENT_ID=<your-programmatic-api-key-public-id>
MDB_MCP_API_CLIENT_SECRET=<your-programmatic-api-key-private-key>
```

Source it in your shell before launching Claude Code, or add the exports to `.zshrc` / a direnv
`.envrc`. **Never commit this file.**

The global pre-commit hook (`~/.config/git/hooks/pre-commit`) will block any staged change that
inlines an `mongodb+srv://` connection string with a password — the env-reference pattern above is
the safe path.

### One manual Atlas UI step — create Programmatic API Keys

DB inspection works without these. For cluster/access-list visibility:

1. Open Atlas → **Project** → **Access Manager** → **API Keys** → **Create API Key**.
2. Role: **Project Read Only** (sufficient for access-list reads and cluster info).
3. Copy the **Public Key** (`MDB_MCP_API_CLIENT_ID`) and **Private Key** (`MDB_MCP_API_CLIENT_SECRET`).
4. Add your current IP to the API key's access list in that same dialog.
5. Paste both into `backend/.env.local`.

---

## Activation

1. Add the `"mongodb"` block to `.mcp.json` under `mcpServers`.
2. Source your env file (`source backend/.env.local` or confirm the vars are exported).
3. Reload Claude Code: `/mcp` → confirm `mongodb` shows as connected.

The server starts on-demand via `npx` — no global install needed.

---

## Verification checklist

Once connected, ask Claude to run these against the `workoutlogger` database:

**Tenant isolation**
```
Find one workout document for user A, then query workouts with that _id but userId = user B's id.
Expect: null / empty — no cross-tenant leak.
```

**Decimal128 / no float drift**
```
Sample 10 sets from the workouts collection. Confirm the `weight` field type is Decimal128
(not Double), and that fractional-kg values (e.g. 52.5, 77.25) are exact.
```

**Importer counts**
```
db.workouts.countDocuments()           → 47
db.workouts.aggregate([{$unwind:"$exercises"},{$unwind:"$exercises.sets"},{$count:"n"}]) → 1533
db.exercises.countDocuments()          → 30  (per the import user)
```

**Atlas admin (if API keys set)**
```
List project access-list entries — confirms which IPs are whitelisted.
Show cluster0 state — confirms M0/M2/M10 tier, region, and paused/running status.
```

These map directly to the invariants enforced in `ApiIntegrationTest` and the importer's exact-count
assertions in `ImportRunner` — running them via MCP gives the same guarantees against the live Atlas
cluster rather than a test fixture.
