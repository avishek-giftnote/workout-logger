# Workout Logger — diagrams

Structural and behavioural diagrams (Mermaid, renders on GitHub). 17 validated diagrams. See `DESIGN.md` for the authoritative
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

  USER ||--o| MACROCYCLE : "0..1 ACTIVE plan (+ terminal history)"
  MACROCYCLE ||--|{ MESOCYCLE : "embeds mesocycles[]"
  MACROCYCLE }o--o| SPLIT : "splitId (schedule)"

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
  BODYWEIGHT_ENTRY {
    string entryId "NOT id — embedded in User.bodyweightLog[]"
    Instant recordedAt
    Decimal128 weightKg "string on wire"
    bool estimated "true only for the import baseline"
  }
  MACROCYCLE {
    string id PK
    string userId FK
    Long version "optimistic lock"
    string status "ACTIVE COMPLETED ENDED"
    string goal "planner goal"
    int mesoIndex
    int week
    string splitId FK "nullable"
    Instant completedAt "nullable"
    Instant endedAt "nullable"
  }
  MESOCYCLE {
    string name "embedded in Macrocycle.mesocycles[]"
    int accumulationWeeks
    string phase "SURPLUS DEFICIT MAINTENANCE"
    BlockType blockType
    IntensityBand intensityBand "rep/RIR band"
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
  class PlanController

  class WorkoutRepository {
    +updateSet(workoutId, setId)
    +lastWorkingSet(exerciseId)
  }
  class ExerciseRepository
  class TemplateRepository
  class SplitRepository
  class UserRepository
  class MeRepository {
    +addBodyweight() atomic
    +putSettingsIfNewer() LWW
  }
  class PlanRepository
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
  MeController ..> MeRepository
  MeController ..> UserRepository
  PlanController ..> PlanRepository

  WorkoutRepository ..> Tenant : AND userId into every query
  ExerciseRepository ..> Tenant
  TemplateRepository ..> Tenant
  SplitRepository ..> Tenant
  MeRepository ..> Tenant
  PlanRepository ..> Tenant

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

### 12. Domain model — full class diagram (every field, shown as it is STORED)

> Types are the **Mongo storage types**, not the Java types: an `@Id` is an `ObjectId`; a cross-reference
> (`userId`, `templateId`, `exerciseId`, `splitId`) is the plain hex **String**; a weight is `Decimal128`
> (serialized as a **string** on the wire); a timestamp is `ISODate`. Boxes tagged `<<embedded>>` have no
> collection of their own — they live inside their parent document. The six collection roots are tagged with
> their collection name.

```mermaid
classDiagram
  direction LR

  class User {
    <<users collection>>
    +ObjectId _id
    +String email
    +String passwordHash "bcrypt"
    +Decimal128 currentBodyweightKg "retired mirror — derived at read"
    +List~BodyweightEntry~ bodyweightLog
    +Profile profile
    +Map settings "device-synced prefs"
    +long settingsUpdatedAt "epoch ms · LWW"
    +ISODate createdAt
    +ISODate updatedAt
  }
  class BodyweightEntry {
    <<embedded>>
    +String entryId "NOT id"
    +ISODate recordedAt
    +Decimal128 weightKg
    +boolean estimated
  }
  class Profile {
    <<embedded>>
    +ISODate dateOfBirth
    +Decimal128 heightCm
    +Sex sex
    +Goal goal
    +ActivityLevel activityLevel
    +Integer initialIntakeKcal
  }
  class Exercise {
    <<exercises collection>>
    +ObjectId _id
    +String userId "tenant"
    +String name "verbatim"
    +String nameKey "unique per user"
    +boolean isBodyweight
    +Equipment equipment
    +ExerciseCategory category
    +String defaultUnit "kg"
    +Integer restSeconds
    +List~CardioMetric~ cardioMetrics
    +List~MuscleContribution~ muscleContributions
    +Laterality laterality
    +Mechanic mechanic
    +Boolean loadable
    +ISODate deletedAt "tombstone"
  }
  class MuscleContribution {
    <<embedded>>
    +Muscle muscle
    +Decimal128 fraction "1.0 primary · 0.3-0.5 secondary"
  }
  class WorkoutTemplate {
    <<templates collection>>
    +ObjectId _id
    +String userId
    +String name
    +List~TemplateExercise~ exercises
  }
  class TemplateExercise {
    <<embedded>>
    +String exerciseId "ref"
    +String name
    +int position
    +int sets "planned count"
    +Integer reps
    +String targetRir
  }
  class Split {
    <<splits collection>>
    +ObjectId _id
    +String userId
    +String name
    +List~String~ templateIds "refs (M-to-N)"
    +List~Integer~ weekdays "0=Mon..6=Sun · nullable"
  }
  class Workout {
    <<workouts collection>>
    +ObjectId _id
    +String userId "tenant"
    +Long version "optimistic lock"
    +ISODate startedAt "unique per user"
    +String startedAtOffset "nullable"
    +Integer durationSeconds
    +String rawDurationText "lossless '1h 29m'"
    +String templateId "ref · nullable"
    +CyclePhase cyclePhase
    +List~ExerciseBlock~ exercises
    +List~Muscle~ soreMuscles "readiness"
    +ISODate deletedAt "tombstone"
  }
  class ExerciseBlock {
    <<embedded>>
    +String exerciseId "ref"
    +String name "immutable snapshot"
    +int position
    +String note
    +List~WorkoutSet~ sets
  }
  class WorkoutSet {
    <<embedded>>
    +String setId "NOT id"
    +int orderIndex
    +SetType setType
    +Decimal128 weight "effective load (incl. bodyweight)"
    +LoadMode loadMode "null = external"
    +Decimal128 loadDelta "added/assist delta"
    +String weightUnit "kg"
    +Integer reps
    +Integer rpe
    +String note
    +ISODate loggedAt "null on import"
    +boolean estimated
    +Integer importRowIndex
    +Map rawImport "original CSV row"
    +SetKind kind "null = STRENGTH"
    +Decimal128 distanceM
    +Integer durationS
    +Decimal128 gradePct
    +Decimal128 elevationGainM
    +Integer cadenceSpm
  }
  class Macrocycle {
    <<plans collection>>
    +ObjectId _id
    +String userId
    +Long version "optimistic lock"
    +String name
    +String status "ACTIVE | COMPLETED | ENDED"
    +int mesoIndex
    +int week
    +String goal "GENERAL_HYPERTROPHY | MUSCLE_FOCUS | STRENGTH | CONTEST_PREP"
    +ISODate targetDate "nullable"
    +List~Muscle~ focusMuscles "nullable"
    +List~Mesocycle~ mesocycles
    +String splitId "ref · nullable"
    +ISODate startedAt
    +ISODate completedAt "nullable"
    +ISODate endedAt "nullable"
  }
  class Mesocycle {
    <<embedded>>
    +String name
    +int accumulationWeeks
    +String phase "SURPLUS | DEFICIT | MAINTENANCE"
    +BlockType blockType "null = HYPERTROPHY"
    +List~Muscle~ focusMuscles
    +IntensityBand intensityBand
  }
  class IntensityBand {
    <<embedded>>
    +int repLow
    +int repHigh
    +String targetRir
    +String pctLow "%1RM"
    +String pctHigh "%1RM"
  }

  User "1" *-- "0..*" BodyweightEntry : embeds
  User "1" *-- "0..1" Profile : embeds
  Exercise "1" *-- "0..*" MuscleContribution : embeds
  WorkoutTemplate "1" *-- "1..*" TemplateExercise : embeds
  Workout "1" *-- "1..*" ExerciseBlock : embeds
  ExerciseBlock "1" *-- "1..*" WorkoutSet : embeds
  Macrocycle "1" *-- "1..*" Mesocycle : embeds
  Mesocycle "1" *-- "0..1" IntensityBand : embeds

  Workout ..> WorkoutTemplate : templateId
  ExerciseBlock ..> Exercise : exerciseId
  TemplateExercise ..> Exercise : exerciseId
  Split ..> WorkoutTemplate : templateIds
  Macrocycle ..> Split : splitId

  class Muscle { <<enumeration>> CHEST FRONT_DELT SIDE_DELT REAR_DELT LAT UPPER_BACK TRAP BICEP TRICEP FOREARM QUAD HAMSTRING GLUTE CALF ABS }
  class Equipment { <<enumeration>> DUMBBELL BARBELL SMITH_MACHINE KETTLEBELL MACHINE CABLE BODYWEIGHT OTHER }
  class ExerciseCategory { <<enumeration>> STRENGTH CARDIO }
  class CardioMetric { <<enumeration>> DISTANCE DURATION PACE GRADE ELEVATION CADENCE }
  class SetType { <<enumeration>> WARMUP WORKING DROP FAILURE }
  class SetKind { <<enumeration>> STRENGTH CARDIO }
  class LoadMode { <<enumeration>> BODYWEIGHT ADDED ASSISTED }
  class CyclePhase { <<enumeration>> ACCUMULATION DELOAD }
  class BlockType { <<enumeration>> HYPERTROPHY STRENGTH PEAK RESENSITIZATION MAINTENANCE PREP }
  class Laterality { <<enumeration>> BILATERAL ISOLATERAL UNILATERAL }
  class Mechanic { <<enumeration>> COMPOUND ISOLATION }
  class Sex { <<enumeration>> MALE FEMALE UNSPECIFIED }
  class Goal { <<enumeration>> GAIN_MUSCLE LOSE_FAT MAINTAIN GAIN_STRENGTH }
  class ActivityLevel { <<enumeration>> SEDENTARY LIGHT MODERATE ACTIVE VERY_ACTIVE }
```

> **Reading it:** solid diamond ◆ = *embedding* (the child is a sub-document of the parent and saved with it);
> dashed arrow ⇢ = *id reference* (a hex-string field resolved in app code — MongoDB does no joins). Every
> collection root carries `userId`, the tenant key ANDed into every query. `Profile.goal` (the `Goal` enum) and
> `Macrocycle.goal` (a String) are **different** vocabularies. Pace/speed are derived from distance/duration and
> never stored. Full field-by-field notes live in `DESIGN.md`.

### 13. Sequence — log a planned session (the living plan)

```mermaid
sequenceDiagram
  actor U as User
  participant LP as LogWorkoutPage
  participant LS as LocalStore (OPFS/SQLite)
  participant RX as prescription.ts
  participant PD as periodization.ts
  participant API as Api client
  participant WC as WorkoutController
  participant WR as WorkoutRepository
  participant DB as MongoDB
  U->>LP: navigate to /start
  LP->>LS: loadDraft(wl.draft.new)?
  alt draft found
    LP-->>U: banner — Resume or Discard
    U->>LP: Resume (restore blocks) or Discard (clear draft)
  end
  U->>LP: start from template
  LP->>PD: currentMicro(plan) → meso, week
  LP->>PD: phaseMod(meso.phase) → rirFloor, progressMult
  LP->>RX: topWorkingSet(workouts, exerciseId)
  LP->>RX: rirWave(week, accumWeeks, rirFloor)
  Note over LP,RX: block-transition guard — if prevMeso.repHigh ≠ current repHigh·<br/>progressedSeed anchors to e1RM for new rep target (skips double-progression bump)
  LP->>RX: progressedSeed(prev, repLow, repHigh, prevRepHigh?)
  LP->>RX: readiness(workouts, muscle, target) → trim?
  RX-->>LP: seeded sets (load · reps · RPE), eased if sore/short
  LP->>LS: saveDraft(blocks) [debounced 500 ms on each edit]
  U->>LP: log sets, mark sore muscles, Finish
  LP->>LS: clearDraft()
  LP->>API: createWorkout(req incl. cyclePhase, soreMuscles)
  API->>WC: POST /api/workouts
  WC->>WC: DtoMapper.toWorkout (mints setIds · validates set fields)
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
  participant SW as scheduleWeek
  participant WC as WeekCalendar
  participant API as Api client
  participant BE as Plan/Template/Split controllers
  participant DB as MongoDB
  U->>MP: goal · duration/date · days · focus
  MP->>EC: measured phase (HIGH-confidence only)
  MP->>PM: planMacrocycle(goal, weeks, focus, days, catalog, measuredPhase)
  PM->>PM: recipeUnit(goal) → blocks · mkBlock + clampPhase(measured)
  PM->>PM: generateSplit → frequency-by-design (prime movers/focus ≥2×) · orderForRecovery · daySlots
  PM->>SW: scheduleWeek(days, effOf) → schedule: number[] (0=Mon…6=Sun per template slot)
  SW-->>PM: weekday assignment · null slots = rest days
  PM-->>MP: PlanPreview (timeline · muscle-group SLOTS w/ defaults · warnings · schedule[])
  MP->>WC: render WeekCalendar(schedule, editable=true)
  U->>WC: drag/swap training day assignments
  WC-->>MP: updated schedule[]
  U->>MP: swap any slot's exercise (dropdown of catalog lifts that train the muscle)
  U->>MP: Accept & start
  loop each template
    MP->>MP: resolve slots → chosen exerciseIds (merge same-exercise slots, cap sets)
    MP->>API: createTemplate(exerciseId, reps, targetRir, sets)
    API->>BE: POST /api/templates
  end
  MP->>API: createSplit(name, templateIds, weekdays[])
  MP->>API: createPlan(mesocycles, goal, targetDate, focusMuscles, splitId)
  API->>BE: POST /api/splits · POST /api/plan
  BE->>DB: insert templates · split (w/ weekdays) · plan (ACTIVE · week 1 · splitId)
  DB-->>MP: invalidate ["templates","splits","plan"] → active-plan view
```

### 15. Sequence — energy "Coach" estimate (read-time, gated)

```mermaid
sequenceDiagram
  participant CC as CoachCard / PlanPage
  participant API as Api client
  participant MC as MeController
  participant WR as WorkoutRepository
  participant ES as EnergyService
  CC->>API: energy()
  API->>MC: GET /api/me/energy
  MC->>WR: countSince(now − 7d) (tenant-scoped)
  WR-->>MC: recentSessionCount
  MC->>ES: estimate(currentUser, recentSessionCount)
  ES->>ES: profile gate (sex, DOB, height, activity)
  ES->>ES: Mifflin×PAL → maintenance ±8% (±12% unspec) · neatBmr · workoutKcal (display-only)
  ES->>ES: real weigh-ins ≥6 over ≥14d (28d female)?
  alt below gate
    ES-->>CC: INSUFFICIENT_DATA (+ Mifflin range if profile complete)
  else has trend
    ES->>ES: EWMA smooth (α≈0.067 · 0.046 female) → anchor = latest smoothed
    ES->>ES: Theil–Sen slope (robust) · CI from RAW residuals · Student-t (df=n−2)
    ES->>ES: phase vs ±0.1%bw/wk dead-band (±0.2% female · anchored to latest EWMA)
    alt CI straddles band AND ciWk > 3× it
      ES-->>CC: TREND_ONLY (rate only · no phase · null kcal)
    else
      ES->>ES: confidence HIGH/MED/LOW · kcal = slope×7700 (null at maintenance)
      ES-->>CC: PHASE_HIGH/MEDIUM/LOW (phase, rate, kcal, modelVersion)
    end
  end
  CC->>CC: render pill/states · PlanPage clamps block phase only at PHASE_HIGH
```

### 16. Sequence — verified sign-up (code) → account + default-catalog seeding

```mermaid
sequenceDiagram
  actor U as User
  participant API as Api client
  participant AS as AuthController / AuthService
  participant CH as authChallenges
  participant ES as EmailSender (stub)
  participant UR as UserRepository
  participant DS as DefaultExerciseSeeder
  U->>API: signupRequest(email)
  API->>AS: POST /api/auth/signup/request
  AS->>AS: proceed only if email is free (else a neutral no-op)
  AS->>CH: atomic send-cap bump · store SHA-256(6-digit code + pepper) · 15-min expiry
  AS->>ES: email the code (dev log · file outbox · real provider TBD)
  AS-->>U: 202 Accepted (enumeration-neutral · identical body either way)
  U->>API: signupVerify(email · code · password ×2)
  API->>AS: POST /api/auth/signup/verify
  AS->>CH: atomic claim-attempt (unexpired · under the 5-try cap)
  AS->>AS: constant-time compare code hash
  AS->>UR: save(new User · tokenVersion 0)
  AS->>DS: seed(userId) → 84-exercise catalog
  AS->>CH: consume (single-use · no replay)
  AS-->>U: JWT (subject=userId · tv claim) + a ready-to-use catalog
  Note over AS,UR: every authed request re-checks the token's tv vs User.tokenVersion — reset/wipe bump it to revoke
```

### 17. Sequence — plan completion + history

```mermaid
sequenceDiagram
  actor U as User
  participant PP as PlanPage
  participant API as Api client
  participant PC as PlanController
  participant PR as PlanRepository (tenant)
  participant DB as MongoDB
  Note over PP,DB: normal week-by-week progression via POST /api/plan/advance
  PP->>API: advancePlan() — last week of last mesocycle
  API->>PC: POST /api/plan/advance
  PC->>PR: advance() — mesoIndex · week at end
  PR->>DB: status → COMPLETED · completedAt = now()
  DB-->>PP: MacrocycleDto (status=COMPLETED) → invalidate ["plan"]
  PP->>API: GET /api/plan
  API->>PC: getActivePlan()
  PC-->>PP: 204 No Content (no active plan)
  PP->>PP: query plan history for newest terminal plan
  PP->>API: GET /api/plan/history
  API->>PC: history()
  PC->>PR: findByUserId (COMPLETED + ENDED · newest first)
  PR-->>PP: List~MacrocycleDto~
  PP->>PP: show CompletionScreen (plan name · goal · summary actions)
  Note over PP: actions: Start new plan · Plan again (prefill) · View past plans · Dismiss
  U->>PP: "End plan" (any time — not just at completion)
  PP->>API: endPlan() → DELETE /api/plan
  API->>PC: end()
  PC->>PR: status → ENDED · endedAt = now()
  PR->>DB: update plan doc
  DB-->>PP: 204 → invalidate ["plan"] · PastPlans shows "Ended early" tag
```
