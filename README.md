# Workout Logger

A web app for logging strength workouts, with a native mobile app planned for a later phase.
Bootstrapped from a real [Strong](https://www.strong.app/) export and designed around it.

## Status

- ✅ **Architecture** — see [`DESIGN.md`](DESIGN.md) (stack, MongoDB document model, importer spec,
  bodyweight model).
- ✅ **Backend (Java + Spring Boot + MongoDB)** — schema + one-time Strong CSV importer. See
  [`backend/README.md`](backend/README.md).
- ⬜ **REST API + auth/isolation, last-working-set, OpenAPI client** — next milestone.
- ⬜ **React frontend** — after the API contract is generated.
- ⬜ **Mobile (React Native/Expo)** — after the web app is complete.

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Java 21 · Spring Boot · Spring Data MongoDB |
| Database | MongoDB (Decimal128 for weights) |
| Frontend | React (Vite) + CSS *(planned)* |
| Contracts | OpenAPI → generated TypeScript client *(planned)* |

## Layout

```
DESIGN.md            full architecture & decisions
backend/             Spring Boot backend (schema + Strong CSV importer)
tools/verify_import.py   runnable reference that proves the importer transform on real data
```

## Personal data

The Strong export (`strong_workouts.csv`) and the generated `tools/import_preview.json` contain
real training history and are **git-ignored** — they are not part of this repo. To run the importer
or the verification harness, place your own `strong_workouts.csv` at the repo root.
