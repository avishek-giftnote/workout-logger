# Browser MCP — Playwright in-loop UI verification

Wires a live Chromium browser into Claude Code so agents can open the running app, interact with it,
and take screenshots — replacing mocked Playwright specs or manual "go check that it renders" steps.

Package: **`@playwright/mcp`** (Microsoft's official Playwright MCP server). No global install needed;
`npx` downloads on first use. Node 18+ required.

---

## `.mcp.json` block

```json
"playwright": {
  "command": "npx",
  "args": [
    "@playwright/mcp@latest",
    "--browser", "chrome",
    "--headless",
    "--isolated",
    "--allowed-origins", "http://localhost:5173;http://localhost:4173;http://localhost:8080"
  ]
}
```

`--isolated` gives each Claude session a clean in-memory profile (no stale cookies from a prior run).
`--allowed-origins` locks the browser to the local dev stack — it can't reach the open internet.
Drop `--headless` when you want to watch the browser during debugging.

---

## Activation

1. The project `.mcp.json` at repo root must contain the block above (merged under `mcpServers`).
2. Restart Claude Code in this project directory (or `/mcp` → reload) — the Playwright tools appear
   in the tool list once the server handshakes.
3. Verify with `/mcp` — `playwright` should show status **connected**.

No `npx playwright install` needed for `@playwright/mcp` in most cases. If Chrome is missing, run
`npx playwright install chrome` once.

---

## Prerequisites — stack must be running

The MCP server opens a browser; it does not start the app. Before any UI verification session:

```bash
# Terminal 1 — backend (MongoDB Atlas URI in env or .env)
cd backend && mvn spring-boot:run

# Terminal 2 — frontend dev server (proxies /api → :8080)
cd frontend && npm run dev
```

Both `:8080` (API) and `:5173` (Vite) must be up before asking Claude to navigate.

---

## Verification flow — planner slot UI

**Goal:** confirm the macrocycle planner's muscle-group slot dropdowns render and Side delts appear in
at least two day sections.

Tell Claude (or write a sub-agent prompt with):

```
1. Navigate to http://localhost:5173. If redirected to /login, register a test account
   (email: verify@test.local, password: Test1234!) then log in.
2. Go to http://localhost:5173/plan.
3. Assert the page contains at least one element that looks like a day/slot section
   (a heading or label containing "Day" or a weekday name).
4. Assert that a dropdown or select for muscle groups is visible in ≥2 of those sections.
5. Assert that "Side delts" (or "Lateral delts") appears as an option in ≥2 day sections.
6. Take a screenshot and report what you see.
```

The MCP tools Claude uses under the hood: `browser_navigate`, `browser_snapshot` (accessibility tree,
faster than screenshots for assertions), `browser_take_screenshot`, `browser_click`, `browser_type`.
Prefer `browser_snapshot` for assertions — it's text-based and cheaper. Use `browser_take_screenshot`
only when you need visual evidence.

---

## Useful flags reference

| Flag | Effect |
|---|---|
| `--headless` | No visible window (default for CI / in-loop). Drop for debugging. |
| `--browser chrome\|firefox\|webkit\|msedge` | Browser engine. `chrome` is the default. |
| `--isolated` | In-memory profile — no cookies/state across sessions. |
| `--allowed-origins <list>` | Semicolon-separated origins the browser may contact. |
| `--port <n>` | Run as HTTP/SSE server instead of stdio (useful for remote agents). |
| `--storage-state <path>` | Load saved auth from a `playwright auth` JSON dump (skip login step). |
| `--timeout-action <ms>` | Per-action timeout (default 5000). Raise if the app is slow to hydrate. |

---

## Notes

- The dev Vite proxy (`/api → :8080`) means you only need to allow `:5173` for most flows. Add `:8080`
  to `--allowed-origins` if an agent needs to hit the API directly (e.g. curl-style health checks via
  the browser fetch API).
- For the E2E Playwright spec suite (`frontend/e2e/`), use `npm run e2e` directly — that's a separate
  test runner, not this MCP server. This MCP integration is for **interactive, in-loop agent verification**,
  not the CI gate.
- Registered test accounts pile up in the dev DB. Either use a fixed `verify@test.local` address (it
  already exists after the first run) or flush the `users` collection between sessions.
