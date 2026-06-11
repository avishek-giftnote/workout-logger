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
    LS["localStorage: JWT + settings"]
    UI --> Q
    UI --> LS
  end

  Client -->|"/api/* — Bearer JWT; decimals as STRINGS"| FILT

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
  SS --> SET["settings.tsx — context (localStorage)"]

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
