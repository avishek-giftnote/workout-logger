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
npm run build        # tsc && vite build  (type-checks + production bundle in dist/)
npm run typecheck    # tsc --noEmit — the only lint gate; there is no ESLint
```

## Structure

```
src/
  api/        types.ts (mirrors backend DTOs) · client.ts (typed fetch + token + ApiError)
  logging/    engine.tsx — shared set editor, pickers, helpers (used by new + edit pages)
  auth/ settings/   token context · localStorage-backed settings (prev-source)
  pages/      WorkoutsPage · WorkoutDetail/EditWorkoutPage · LogWorkoutPage + StartChooser ·
              ExerciseList/DetailPage · LoginPage
  components/  SettingsSidebar
  styles.css   the whole design system (tokens, components, motion)
```

## Key UX

- **Shared logging engine** (`logging/engine.tsx`) — `ExerciseBlockEditor` etc. reused by the
  new-session and edit-session pages; change logging UX here, not in the pages.
- **Bodyweight delta entry** — one field per calisthenics set: enter the *delta* (`+`/`−`), the app
  shows the cumulative effective load and sends `weight` + `loadMode` + `loadDelta`.
- **Copy-last-set / placeholders** — seeded from `last-working-set` (warmups excluded); the settings
  sidebar switches the source between any workout and the same template.
- **Templates, splits, equipment** — Start groups templates into collapsible splits (with an inline
  template builder); each exercise has a settable equipment type.
- **Decimal-safe** — weights stay strings end-to-end; parsed to numbers only for transient display.

## Regenerating API types from OpenAPI

`src/api/types.ts` is hand-written to match the backend. To regenerate from the live contract:

```bash
npx openapi-typescript http://localhost:8080/v3/api-docs -o src/api/schema.ts
```
