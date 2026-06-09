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

`StrongImporterTest` asserts the exact counts against `../strong_workouts.csv`;
`StrongParsersTest` covers the `U+202F` date landmine and all 4 duration shapes.

## Notes / next milestone

- Import is a **one-time bootstrap**; re-running with `persist=true` relies on the unique
  `{userId, startedAt}` index to avoid duplicate sessions (upsert semantics to be added with the
  REST layer).
- Not yet built (next milestone): REST controllers, JWT auth + the centralized `userId` isolation
  aspect, the deterministic `last-working-set` aggregation, and OpenAPI/TS client generation.
- `weight` is stored as `Decimal128`; the API will serialize it as a decimal **string** (DESIGN §3.1).
