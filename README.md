# Workout Logger

A web app for logging strength workouts, bootstrapped from a real [Strong](https://www.strong.app/)
export. Java/Spring Boot + MongoDB backend, React/Vite frontend. Native mobile and cardio are future work.

## Status — web app built

- **Backend** (Java 21 · Spring Boot · MongoDB): schema + one-time Strong CSV importer, REST API with
  JWT auth, by-construction `userId` isolation, decimal-as-string weights, deterministic `last-working-set`.
- **Frontend** (React · Vite · TS): Training Log with workout detail / edit / delete; Start from an
  empty session or a template; **splits** (collapsible groups of templates) with an inline template
  builder; per-exercise **equipment**; bodyweight delta logging + copy-last-set; Exercise List + history;
  settings sidebar.
- Architecture in [`DESIGN.md`](DESIGN.md); component docs in [`backend/`](backend/README.md) and
  [`frontend/`](frontend/README.md); conventions/invariants in [`CLAUDE.md`](CLAUDE.md).

## Run (needs MongoDB on `:27017`)

```bash
cd backend && MONGODB_URI=… IMPORT_USER_PASSWORD=… mvn spring-boot:run \
  -Dspring-boot.run.profiles=import -Dspring-boot.run.arguments="--importer.persist=true"  # load Strong data once
cd backend && MONGODB_URI=… SECURITY_JWT_SECRET=… mvn spring-boot:run                       # API on :8080
cd frontend && npm install && npm run dev                                                   # UI on :5173 (proxies /api)
```

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Java 21 · Spring Boot · Spring Data MongoDB |
| Database | MongoDB (Decimal128 weights) |
| Frontend | React · Vite · TypeScript · TanStack Query |
| Contracts | OpenAPI (`/v3/api-docs`) |

## Personal data

`strong_workouts.csv` and the generated `tools/import_preview.json` are real training history and are
**git-ignored**. Drop your own `strong_workouts.csv` at the repo root to run the importer or
`tools/verify_import.py`.
