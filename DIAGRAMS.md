# Workout Logger — diagrams

Structural and behavioural diagrams (Mermaid, renders on GitHub). See `DESIGN.md` for the authoritative
architecture record and `CLAUDE.md` for invariants. Diagrams reflect the current code.

---

## Structural

### 1. System architecture (components & runtime)

```mermaid
flowchart LR
  subgraph Client["Browser — React + Vite SPA"]
    UI["Pages + shared logging engine"]
    Q["TanStack Query cache"]
    LS["localStorage: JWT"]
    SQ["SQLite via OPFS (LocalStore) — local-first settings"]
    UI --> Q
    UI --> LS
    UI --> SQ
  end

  Client -->|"/api/* — Bearer JWT; decimals as STRINGS"| FILT
  SQ -->|"GET/PUT /api/me/settings — last-write-wins sync"| FILT

  subgraph Server["Spring Boot :8080"]
    FILT["JwtAuthenticationFilter sets Tenant(userId)"]
    CTRL["Controllers (thin)"]
    REPO["Repositories — tenant-scoped"]
    MT["MongoTemplate + BigDecimal↔Decimal128"]
    FILT --> CTRL --> REPO --> MT
  end

  MT --> DB[("MongoDB")]

  subgraph Import["Spring profile: import (one-time CLI)"]
    CSV["Strong CSV export"] --> SI["StrongImporter — pure transform"] --> MT
  end
```

### 2. Data model (collections, embedding & references)

> A **workout session is one document** that embeds `exercises[]`, each embedding `sets[]`. Everything else
> relates by id reference (many-to-many), not joins. Every collection is scoped by `userId`.

```mermaid
erDiagram
  USER ||--o{ EXERCISE : "owns catalog"
  USER ||--o{ WORKOUT_TEMPLATE : owns
  USER ||--o{ SPLIT : owns
  USER ||--o{ WORKOUT : owns
  USER ||--o{ BODYWEIGHT_ENTRY : records

  WORKOUT_TEMPLATE ||--o{ TEMPLATE_EXERCISE : "lists (with set count)"
  TEMPLATE_EXERCISE }o--|| EXERCISE : references
  SPLIT }o--o{ WORKOUT_TEMPLATE : "groups via templateIds"

  WORKOUT ||--|{ EXERCISE_BLOCK : "embeds exercises[]"
  EXERCISE_BLOCK ||--|{ WORKOUT_SET : "embeds sets[]"
  EXERCISE_BLOCK }o--|| EXERCISE : "references exerciseId"
  WORKOUT }o--o| WORKOUT_TEMPLATE : "optional templateId"

  USER {
    string id PK
    string email UK
    string passwordHash
    Decimal128 currentBodyweightKg "string on wire"
    Map settings "synced UI prefs"
    long settingsUpdatedAt "epoch ms — LWW"
  }
  EXERCISE {
    string id PK
    string userId FK
    string name
    string nameKey "partial-unique"
    Equipment equipment
    ExerciseCategory category "STRENGTH or CARDIO"
    bool isBodyweight
  }
  WORKOUT {
    string id PK
    string userId FK
    Instant startedAt
    string templateId FK "nullable"
    int durationSeconds
    Instant updatedAt
    Instant deletedAt "tombstone"
  }
  WORKOUT_SET {
    string setId "NOT id (maps to _id)"
    int orderIndex
    SetType setType "WARMUP WORKING DROP FAILURE"
    SetKind kind "null=STRENGTH or CARDIO"
    Decimal128 weight "effective load, string"
    LoadMode loadMode
    Decimal128 loadDelta
    int reps
    int rpe
    Decimal128 distanceM
    int durationS
    Decimal128 gradePct
    Decimal128 elevationGainM
    int cadenceSpm
  }
```

### 3. Backend layers (request path + tenant isolation)

```mermaid
classDiagram
  direction LR

  class JwtAuthenticationFilter
  class Tenant {
    +userId() String
  }
  class JwtService {
    +issue(userId) String
    +parse(token) Claims
  }

  class AuthController
  class WorkoutController
  class ExerciseController
  class TemplateController
  class SplitController
  class MeController

  class WorkoutRepository {
    +updateSet(workoutId, setId)
    +lastWorkingSet(exerciseId)
  }
  class ExerciseRepository
  class TemplateRepository
  class SplitRepository
  class UserRepository
  class DtoMapper {
    +toDto() WorkoutDto
    +toBlocks() Workout
  }

  class Workout
  class ExerciseBlock
  class WorkoutSet

  JwtAuthenticationFilter ..> JwtService : validate
  JwtAuthenticationFilter ..> Tenant : set userId

  AuthController ..> UserRepository
  AuthController ..> JwtService
  WorkoutController ..> WorkoutRepository
  ExerciseController ..> ExerciseRepository
  TemplateController ..> TemplateRepository
  SplitController ..> SplitRepository
  MeController ..> UserRepository

  WorkoutRepository ..> Tenant : AND userId into every query
  ExerciseRepository ..> Tenant
  TemplateRepository ..> Tenant
  SplitRepository ..> Tenant

  WorkoutController ..> DtoMapper
  Workout "1" *-- "many" ExerciseBlock : embeds
  ExerciseBlock "1" *-- "many" WorkoutSet : embeds
```

### 4. Frontend modules

```mermaid
flowchart TD
  main["main.tsx"] --> App["App.tsx — Router + topbar"]
  App --> Auth["auth/auth.tsx — JWT guard, /api/me"]
  App --> SS["components/SettingsSidebar"]
  SS --> SET["settings.tsx — context (local-first)"]
  SET --> LST["local/LocalStore — SQLite-WASM/OPFS (+ localStorage fallback)"]
  SET -->|"LWW sync"| CL

  App --> Pages
  subgraph Pages
    LP["LoginPage"]
    WL["WorkoutsPage (home)"]
    WD["WorkoutDetailPage"]
    EW["EditWorkoutPage"]
    LW["LogWorkoutPage (/start)"]
    SC["StartChooser"]
    ELi["ExerciseListPage"]
    ED["ExerciseDetailPage"]
  end

  LW --> SC
  LW --> ENG["logging/engine.tsx — shared engine"]
  EW --> ENG
  SC --> ENG
  LW --> RT["components/RestTimer"]
  LW --> SET
  WL --> CH["components/Chart"]
  ED --> CH

  ENG --> CL["api/client.ts (typed fetch + JWT)"]
  Pages --> CL
  CL --> BE[("Spring Boot /api")]
```

---

## Behavioural

### 5. Authentication & per-request tenant isolation

```mermaid
sequenceDiagram
  actor U as User
  participant FE as React SPA
  participant FT as JwtAuthenticationFilter
  participant AC as AuthController
  participant UR as UserRepository
  participant JS as JwtService

  U->>FE: email + password
  FE->>AC: POST /api/auth/login
  AC->>UR: find by email, verify bcrypt
  AC->>JS: issue JWT(userId)
  JS-->>AC: token
  AC-->>FE: { token }
  FE->>FE: store token in localStorage

  Note over FE,JS: every later request carries Bearer token
  FE->>FT: GET /api/workouts (Authorization: Bearer)
  FT->>JS: parse + validate
  FT->>FT: set Tenant.userId from claims
  FT->>UR: (downstream) repo ANDs userId into query
  Note right of FT: 401 if token invalid/expired -><br/>client clears token, routes to Login
```

### 6. Logging a workout (start → complete → finish → save)

```mermaid
sequenceDiagram
  actor U as User
  participant LW as LogWorkoutPage
  participant EN as engine / ExerciseBlockEditor
  participant API as api/client
  participant WC as WorkoutController
  participant WR as WorkoutRepository (tenant)

  U->>LW: Start from template T
  LW->>API: GET /api/workouts (history) + templates
  API-->>LW: prior sessions
  Note over LW,EN: seed set count = last time<br/>last weight/reps/RPE shown as placeholders

  loop each set actually performed
    U->>EN: tap ✓ (complete)
    EN->>EN: commit placeholders to real values, restart rest timer
  end

  U->>LW: Finish
  alt some sets never ticked
    LW-->>U: popup — Continue vs Discard & finish
    U->>LW: Discard & finish
  end
  LW->>LW: keep only done sets, drop empty blocks
  LW->>API: POST /api/workouts { exercises[].sets[] }  (decimals as strings)
  API->>WC: create
  WC->>WR: insert (userId from Tenant)
  WR-->>WC: WorkoutDto
  WC-->>LW: 201 Created
  opt new lineup, or session differs from its template
    LW-->>U: Save as / update template? (done sets only)
  end
  LW->>U: navigate to Training Log
```

### 7. A set's lifecycle (placeholder → completed → saved/discarded)

```mermaid
stateDiagram-v2
  [*] --> Seeded: new session — placeholders from last time
  [*] --> Filled: editing an existing workout

  Seeded --> Editing: type weight / reps / ...
  Seeded --> Completed: tap ✓ (commit placeholders)
  Editing --> Completed: tap ✓
  Completed --> Editing: untick

  Completed --> Saved: Finish (only ✓ sets persist)
  Seeded --> Discarded: Finish — never ticked
  Editing --> Discarded: Finish — never ticked
  Filled --> Saved: Save (edit persists all sets)

  Saved --> [*]
  Discarded --> [*]
```

### 8. Finish-workout decision (discarding unfinished sets)

```mermaid
flowchart TD
  A["Tap Finish"] --> B{"any unticked sets?"}
  B -- "no" --> S["Save"]
  B -- "yes" --> P["Popup: Continue / Discard & finish"]
  P -- "Continue workout" --> A2["Back to logging"]
  P -- "Discard & finish" --> F["Keep only ✓ sets; drop empty exercises"]
  F --> C{"any completed sets left?"}
  C -- "no" --> X["Discard whole workout, leave"]
  C -- "yes" --> S
  S --> T{"new lineup, or differs from template?"}
  T -- "yes" --> D["Prompt: save / update template (completed sets only)"]
  T -- "no" --> E["Go to Training Log"]
  D --> E
```

### 9. Editing a completed workout

```mermaid
sequenceDiagram
  actor U as User
  participant ED as EditWorkoutPage
  participant EN as engine (filledSet)
  participant API as api/client
  participant WC as WorkoutController
  participant WR as WorkoutRepository (tenant)

  U->>ED: open /previous-workouts/{id}/edit
  ED->>API: GET /api/workouts/{id}
  API->>WC: find
  WC->>WR: findOne(id) AND userId
  WR-->>ED: WorkoutDto (404 if not owner)
  Note over ED,EN: blocks built with real values filled in<br/>existing sets shown as already-completed
  U->>ED: change sets / reorder / add-remove exercises / notes
  U->>ED: Save
  ED->>API: PUT /api/workouts/{id} { exercises[].sets[] }
  API->>WC: update
  WC->>WR: replace blocks (server re-mints setIds), AND userId
  WR-->>WC: updated WorkoutDto
  WC-->>ED: 200 OK
  ED->>U: navigate to detail
```

### 10. Macrocycle planner (Layer 4)

```mermaid
flowchart TD
  I["Inputs: goal · duration or targetDate · focus muscles · days/week"] --> PM["planMacrocycle (pure, tested)"]
  PM --> SEQ{"targetDate set?"}
  SEQ -- "yes" --> BW["lay terminal block on the date (PEAK/STRENGTH), fill backward"]
  SEQ -- "no" --> FW["tile goal recipe forward for durationWeeks"]
  BW --> BLOCKS["ordered Mesocycle blocks (type · weeks · focus · intensityBand)"]
  FW --> BLOCKS
  BLOCKS --> CUR["current block only: pick exercises by muscle map → split + templates"]
  CUR --> WARN{"catalog covers focus muscles?"}
  WARN -- "gaps" --> W["warnings: e.g. side-delt needs a lateral raise you do not have"]
  WARN -- "ok" --> PREVIEW
  W --> PREVIEW["PREVIEW: block timeline + current split/templates + warnings"]
  PREVIEW --> A{"Accept?"}
  A -- "edit" --> PM
  A -- "accept" --> CREATE["POST /api/plan (blocks) + create Split + Templates (additive)"]
  CREATE --> RUN["per-week view drives logging; advance through microcycles"]
```

> blockType (volume band + reps) and energy phase (deficit-trim) are orthogonal axes; accept creates, never
> mutates; only the current block's training is materialized — distal blocks stay as intent.

### 11. Prescription, recovery & autoregulation (Layer 5)

```mermaid
flowchart TD
  P["energy phase (Coach) + blockType"] --> MOD["PHASE_MODIFIERS: volumeMult · rirFloor · progressMult"]
  MOD --> VOL["targetSets × volumeMult → weekly sets/muscle"]
  H{"logged history for exercise?"} -- "yes" --> E1["e1RM = weight ÷ pct(RPE,reps)"]
  H -- "no" --> CS["cold-start: %bodyweight anchor"]
  E1 --> RX
  CS --> RX["working load = round(e1RM × pct(target reps, target RIR))"]
  VOL --> SPLIT["fill split: sets × reps × RIR × load (exact, editable)"]
  RX --> SPLIT
  SPLIT --> SEQ["sequence days: same muscle + synergists ≥48–72h apart"]
  SEQ --> LOG["user logs the session"]
  LOG --> RD{"sore / performance drop?"}
  RD -- "yes" --> TRIM["readiness: next session −sets / +1 RIR"]
  RD -- "no" --> DP["double progression: +reps→+load × progressMult"]
  TRIM --> NEXT["recompute e1RM → pre-fill next session (living plan)"]
  DP --> NEXT
  NEXT --> DL{"MRV reached / perf↓ ×2 / block end?"}
  DL -- "yes" --> DELOAD["prompt deload (~½ MEV, +2–3 RIR)"]
  DL -- "no" --> LOG
```

> Energy phase scales volume/intensity/progression; numbers seed from logged e1RM (else %BW cold-start);
> recovery spacing + readiness keep a muscle from being trained fatigued; everything stays an editable preview.

### 12. Domain model — class diagram (structural)

```mermaid
classDiagram
  class User {
    +String id
    +String email
    +String passwordHash
    +BigDecimal currentBodyweightKg
    +List~BodyweightEntry~ bodyweightLog
    +Profile profile
    +Map~String,String~ settings
    +long settingsUpdatedAt
  }
  class BodyweightEntry {
    +String id
    +Instant recordedAt
    +BigDecimal weightKg
    +boolean estimated
  }
  class Profile {
    +LocalDate dateOfBirth
    +BigDecimal heightCm
    +Sex sex
    +Goal goal
    +ActivityLevel activityLevel
    +Integer initialIntakeKcal
  }
  class Workout {
    +String id
    +String userId
    +Instant startedAt
    +Integer durationSeconds
    +String templateId
    +CyclePhase cyclePhase
    +List~Muscle~ soreMuscles
    +Instant deletedAt
  }
  class ExerciseBlock {
    +String exerciseId
    +String name
    +int position
    +List~WorkoutSet~ sets
  }
  class WorkoutSet {
    +String setId
    +SetType setType
    +BigDecimal weight
    +LoadMode loadMode
    +BigDecimal loadDelta
    +Integer reps
    +Integer rpe
    +SetKind kind
    +BigDecimal distanceM
    +Integer durationS
  }
  class Exercise {
    +String id
    +String userId
    +String name
    +String nameKey
    +boolean isBodyweight
    +Equipment equipment
    +ExerciseCategory category
    +List~CardioMetric~ cardioMetrics
    +List~MuscleContribution~ muscleContributions
    +Laterality laterality
    +Mechanic mechanic
    +Boolean loadable
  }
  class MuscleContribution {
    +Muscle muscle
    +BigDecimal fraction
  }
  class WorkoutTemplate {
    +String id
    +String userId
    +String name
    +List~TemplateExercise~ exercises
  }
  class TemplateExercise {
    +String exerciseId
    +String name
    +int position
    +int sets
    +Integer reps
    +String targetRir
  }
  class Split {
    +String id
    +String userId
    +String name
    +List~String~ templateIds
  }
  class Macrocycle {
    +String id
    +String userId
    +String name
    +String status
    +int mesoIndex
    +int week
    +String goal
    +LocalDate targetDate
    +List~Muscle~ focusMuscles
    +List~Mesocycle~ mesocycles
  }
  class Mesocycle {
    +String name
    +int accumulationWeeks
    +String phase
    +BlockType blockType
    +List~Muscle~ focusMuscles
    +IntensityBand intensityBand
  }
  class IntensityBand {
    +int repLow
    +int repHigh
    +String targetRir
    +String pctLow
    +String pctHigh
  }

  User "1" *-- "*" BodyweightEntry
  User "1" *-- "0..1" Profile
  Workout "1" *-- "*" ExerciseBlock
  ExerciseBlock "1" *-- "*" WorkoutSet
  Exercise "1" *-- "*" MuscleContribution
  WorkoutTemplate "1" *-- "*" TemplateExercise
  Macrocycle "1" *-- "*" Mesocycle
  Mesocycle "1" *-- "0..1" IntensityBand
  Workout ..> WorkoutTemplate : templateId
  ExerciseBlock ..> Exercise : exerciseId
  TemplateExercise ..> Exercise : exerciseId
  Split ..> WorkoutTemplate : templateIds[]
  MuscleContribution ..> Muscle
  Mesocycle ..> BlockType

  class Muscle { <<enumeration>> CHEST LAT QUAD HAMSTRING GLUTE ... ABS (15) }
  class BlockType { <<enumeration>> HYPERTROPHY STRENGTH PEAK RESENSITIZATION MAINTENANCE PREP }
  class CyclePhase { <<enumeration>> ACCUMULATION DELOAD }
  class SetType { <<enumeration>> WARMUP WORKING DROP FAILURE }
  class LoadMode { <<enumeration>> BODYWEIGHT ADDED ASSISTED }
  class Laterality { <<enumeration>> BILATERAL ISOLATERAL UNILATERAL }
  class Mechanic { <<enumeration>> COMPOUND ISOLATION }
```

> Every aggregate carries `userId` (tenant isolation — every repo ANDs it). Decimals are `BigDecimal`
> (Decimal128 in Mongo, strings on the wire). The embedded set id is `setId`, not `id`. Also-present enums:
> Equipment, ExerciseCategory, SetKind, CardioMetric, Sex, Goal, ActivityLevel.

### 13. Sequence — log a planned session (the living plan)

```mermaid
sequenceDiagram
  actor U as User
  participant LP as LogWorkoutPage
  participant RX as prescription.ts
  participant PD as periodization.ts
  participant API as Api client
  participant WC as WorkoutController
  participant WR as WorkoutRepository
  participant DB as MongoDB
  U->>LP: start from template
  LP->>PD: currentMicro(plan) → meso, week
  LP->>PD: phaseMod(meso.phase) → rirFloor, progressMult
  LP->>RX: topWorkingSet(workouts, exerciseId)
  LP->>RX: rirWave(week, accumWeeks, rirFloor)
  LP->>RX: progressedSeed(prev, repLow, repHigh, …)
  LP->>RX: readiness(workouts, muscle, target) → trim?
  RX-->>LP: seeded sets (load · reps · RPE), eased if sore/short
  U->>LP: log sets, mark sore muscles, Finish
  LP->>API: createWorkout(req incl. cyclePhase, soreMuscles)
  API->>WC: POST /api/workouts
  WC->>WC: DtoMapper.toWorkout (mints setIds)
  WC->>WR: insert (tenant userId)
  WR->>DB: insert workouts doc (embedded blocks/sets)
  DB-->>LP: WorkoutDto → invalidate ["workouts"]
```

### 14. Sequence — build & accept a macrocycle plan

```mermaid
sequenceDiagram
  actor U as User
  participant MP as PlanPage / MacroPlanner
  participant EC as Energy query
  participant PM as planMacrocycle
  participant API as Api client
  participant BE as Plan/Template/Split controllers
  participant DB as MongoDB
  U->>MP: goal · duration/date · days · focus
  MP->>EC: measured phase (HIGH-confidence only)
  MP->>PM: planMacrocycle(goal, weeks, focus, days, catalog, measuredPhase)
  PM->>PM: recipeUnit(goal) → blocks · mkBlock + clampPhase(measured)
  PM->>PM: generateSplit → frequency-by-design (prime movers/focus ≥2×) · orderForRecovery · daySlots
  PM-->>MP: preview (timeline · muscle-group SLOTS w/ default exercise · warnings)
  U->>MP: swap any slot's exercise (dropdown of catalog lifts that train the muscle)
  U->>MP: Accept & start
  loop each template
    MP->>MP: resolve slots → chosen exerciseIds (merge same-exercise slots, cap sets)
    MP->>API: createTemplate(exerciseId, reps, targetRir, sets)
    API->>BE: POST /api/templates
  end
  MP->>API: createSplit(templateIds)
  MP->>API: createPlan(mesocycles, goal, targetDate, focusMuscles)
  API->>BE: POST /api/splits, /api/plan
  BE->>DB: insert templates, split, plan (ACTIVE, week 1)
  DB-->>MP: invalidate ["templates","splits","plan"] → active-plan view
```

### 15. Sequence — energy "Coach" estimate (read-time, gated)

```mermaid
sequenceDiagram
  participant CC as CoachCard / PlanPage
  participant API as Api client
  participant MC as MeController
  participant ES as EnergyService
  CC->>API: energy()
  API->>MC: GET /api/me/energy
  MC->>ES: estimate(currentUser)
  ES->>ES: profile gate (sex, DOB, height, activity)
  ES->>ES: real weigh-ins ≥6 over ≥14d (21d female)?
  alt insufficient
    ES-->>CC: GATHERING_DATA (+ Mifflin range if profile complete)
  else ready
    ES->>ES: least-squares slope ± 95% CI (kg/wk)
    ES->>ES: Mifflin–St Jeor × PAL → maintenance ±8%
    ES->>ES: phase vs ±0.1%bw/wk dead-band (anchored to ȳ)
    ES->>ES: confidence from CI half-width · kcal = slope×7700 (null at maintenance)
    ES-->>CC: EnergyDto (phase, confidence, rate, kcal)
  end
  CC->>CC: render pill · PlanPage clamps block phase by measured phase
```

### 16. Sequence — registration → default-catalog seeding

```mermaid
sequenceDiagram
  actor U as User
  participant API as Api client
  participant AC as AuthController
  participant UR as UserRepository
  participant DS as DefaultExerciseSeeder
  participant DB as MongoDB
  U->>API: register(email, password)
  API->>AC: POST /api/auth/register
  AC->>UR: save(new User)
  AC->>DS: seed(userId)
  DS->>DS: load default-exercises.json (84 exercises)
  DS->>DB: insert catalog (muscle map · equipment · laterality · mechanic · loadable)
  AC-->>U: JWT token (+ a ready-to-use exercise catalog)
```
