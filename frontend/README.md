# Workout Logger — Frontend (React + Vite + TypeScript)

The web client. Design language: **"Iron Instrument"** — dark industrial-utilitarian, an acid-volt
accent, monospaced numeric readouts, built for fast one-handed logging in the gym.

## Run

```bash
npm install
npm run dev          # http://localhost:5173 (proxies /api -> http://localhost:8080)
```

Start the backend first (`cd ../backend && mvn spring-boot:run`, with MongoDB up). The Vite dev
server proxies `/api/*` to it, so JWT auth and all data flow through the real API.

```bash
npm run build        # tsc -b && vite build  (type-checks + production bundle in dist/)
npm run typecheck
```

## Structure

```
src/
  api/      types.ts (mirrors backend ApiDtos) · client.ts (typed fetch + token + ApiError)
  auth/     auth.tsx (token context; JWT in localStorage)
  pages/    LoginPage · WorkoutsPage · LogWorkoutPage (the hero)
  styles.css   the whole design system (tokens, components, motion)
```

## Key UX (per the design council)

- **Bodyweight delta entry** — calisthenics use a single field: enter the *delta* (`+ Add` / `Assist`)
  and the app shows the cumulative effective load (`bodyweight ± delta`); it sends `weight` +
  `loadMode` + `loadDelta` to the API.
- **One-tap copy-last-set** — each exercise calls `/exercises/{id}/last-working-set` and seeds the
  first set + the "Last time" line; warmups never pollute it (server excludes them).
- **Decimal-safe** — weights are kept as strings end-to-end; numbers are only parsed for transient
  display math, never for storage.

## Regenerating API types from OpenAPI

`src/api/types.ts` is hand-written to match the backend. To regenerate from the live contract:

```bash
npx openapi-typescript http://localhost:8080/v3/api-docs -o src/api/schema.ts
```
