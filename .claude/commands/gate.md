---
description: Run the full pre-commit gate (frontend + backend) and report pass/fail.
---

Run the project's pre-commit gate exactly as defined in `CLAUDE.md` → "Testing & verification", and report a clear PASS/FAIL for each step. Do NOT commit; just verify.

Run these (stop and surface failures, don't paper over them):

**Frontend** (`cd frontend`):
1. `npx tsc --noEmit` (strict type-check — this is the lint gate)
2. `npm test` (Vitest unit suite)
3. `npm run build` (`tsc && vite build`)

**Backend** (`cd backend`, ensure `JAVA_HOME` points at a JDK 21):
4. `mvn test` (unit tests; no DB needed)
5. If this change touched an **endpoint, DTO, repo, or domain** class: `RUN_MONGO_TESTS=1 mvn test` (needs MongoDB on `localhost:27017` — note it if Mongo isn't available rather than silently skipping).
6. If endpoints changed and the server is running: a `curl` smoke test of the new/changed endpoint.

Also confirm the project invariants still hold (tenant isolation, decimals-as-strings on the wire, additive/nullable fields, data-sufficiency gates).

If `$ARGUMENTS` names a specific area, focus the curl/integration checks there. End with a one-line verdict: **GATE PASSED** or **GATE FAILED (which step)**.
