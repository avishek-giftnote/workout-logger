# Workout Logger — Backend (Java + Spring Boot + MongoDB)

Spring Boot backend for Workout Logger. This milestone delivers the **MongoDB schema** and the
**one-time Strong CSV importer**. See [`../DESIGN.md`](../DESIGN.md) for the full architecture.

## Layout

```
src/main/java/com/workoutlogger/
  domain/        documents (User, Exercise, WorkoutTemplate, Workout) + embedded
                 records (ExerciseBlock, WorkoutSet, ...) + enums (SetType, LoadMode)
  config/        MongoConfig (BigDecimal <-> Decimal128), MongoSchemaInitializer
                 ($jsonSchema validators + indexes)
  importer/      StrongParsers, StrongCsvReader, StrongImporter (pure transform),
                 ImportRunner (CommandLineRunner, "import" profile)
src/test/java/   StrongParsersTest, StrongImporterTest (assert counts vs the real export)
```

The importer transform is the production mirror of the runnable reference in
[`../tools/verify_import.py`](../tools/verify_import.py), which already proves the assertions
(1,533 sets / 47 sessions / 30 exercises / 195 warmups / 61 bodyweight rows) against the real file.

## Prerequisites

The toolchain is not yet installed on this machine. With Homebrew:

```bash
brew install openjdk@21 maven      # JDK 21 + Maven
# Follow brew's note to put openjdk@21 on PATH / JAVA_HOME, e.g.:
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdkhome" 2>/dev/null || \
  export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
```

MongoDB is only needed to *persist* (not for the dry run). Either:

```bash
brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community
# ...or use a free MongoDB Atlas cluster and set MONGODB_URI
```

## Run the importer

All commands from the `backend/` directory.

**Dry run — parse + assert, no MongoDB required:**

```bash
mvn -q spring-boot:run -Dspring-boot.run.profiles=import
```

Expected tail of the log:

```
=== IMPORT RECONCILIATION ===
  sets=1533/1533 sessions=47/47 exercises=30/30 warmups=195/195 bodyweightRows=61/61
  ✅ all counts match verified expectations
--- bodyweight spot check (baseline 75.0 kg) ---
  Pull Up: mode=BODYWEIGHT delta=0.0  -> effective 75.0 kg x 7 reps (estimated=true)
  Pull Up: mode=ADDED      delta=10.0 -> effective 85.0 kg x 6 reps (estimated=true)
```

**Persist into MongoDB** (creates collections + validators + indexes, then loads):

```bash
mvn -q spring-boot:run -Dspring-boot.run.profiles=import \
  -Dspring-boot.run.arguments="--importer.persist=true --importer.current-bodyweight-kg=72.5"
```

Config knobs (env var → property): `IMPORT_CSV` → `importer.csv-path`,
`IMPORT_BODYWEIGHT` → `importer.current-bodyweight-kg`, `IMPORT_PERSIST` → `importer.persist`,
`MONGODB_URI` → Mongo connection (default `mongodb://localhost:27017/workoutlogger`).

## Run the tests

```bash
mvn -q test
```

`StrongImporterTest`/`StrongParsersTest` run with no DB (`U+202F` date landmine, durations, counts).
`JwtServiceTest` runs with no DB. `ApiIntegrationTest` needs MongoDB and is gated:

```bash
RUN_MONGO_TESTS=1 mvn -q test     # also runs the isolation + last-working-set e2e tests
```

## REST API

Run the server (needs MongoDB up):

```bash
mvn -q spring-boot:run
```

- OpenAPI JSON: `http://localhost:8080/v3/api-docs` · Swagger UI: `http://localhost:8080/swagger-ui.html`
- **Auth** is JWT Bearer. Everything except `/api/auth/**` and the docs requires `Authorization: Bearer <token>`.
- **`userId` isolation** is enforced by construction: every repository reads the JWT principal via
  `Tenant` and ANDs it into every query/update — `ApiIntegrationTest` proves user B cannot read user
  A's workout (404) and that an unauthenticated request is 401.
- **Weights are decimal strings on the wire** (`"55.0"`), never JSON numbers (DESIGN §3.1).

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` · `/api/auth/login` | get a JWT (`{token,userId,email}`) |
| GET | `/api/me` · PUT `/api/me/bodyweight` | profile + record current bodyweight |
| GET/POST | `/api/exercises` | list / create (409 returns existing `exerciseId` on name clash) |
| GET | `/api/exercises/{id}/last-working-set` | deterministic copy-last-set source (excludes warmups) |
| GET/POST | `/api/workouts` · GET `/api/workouts/{id}` | list / create / fetch a session |
| PATCH | `/api/workouts/{workoutId}/sets/{setId}` | granular set update (addressed by setId, not position) |
| DELETE | `/api/workouts/{id}` | soft-delete |
| GET | `/api/templates` · `/api/templates/{id}` | reconstructed templates |

Quick smoke test:

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"password123"}' | jq -r .token)
curl -s localhost:8080/api/exercises -H "Authorization: Bearer $TOKEN"
```

## Generating the TypeScript client (for the React app)

The OpenAPI document is the contract. With the server running:

```bash
npx openapi-typescript http://localhost:8080/v3/api-docs -o ../frontend/src/api/schema.ts
# or a full client:
npx @openapitools/openapi-generator-cli generate \
  -i http://localhost:8080/v3/api-docs -g typescript-fetch -o ../frontend/src/api
```

## Notes / next milestone

- Granular set updates bump `version` + `updatedAt` but do not yet enforce `If-Match` optimistic
  locking — that lands with the offline/sync layer (mobile phase).
- Import remains a **one-time bootstrap** (unique `{userId, startedAt}` index guards duplicates).
- Next: the **React frontend** (Vite) consuming the generated client — logging screen with the
  single bodyweight field + `last-working-set` copy, then progress charts.
