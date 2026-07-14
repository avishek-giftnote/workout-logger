# Council Brief: Cloud Sync for workout-logger (BUILD vs ADOPT)

_Recommend-only deliberation, 2026-07-02. Two rounds (independent positions → cross-examination →
Opus synthesis). Members: systems-architect, backend-engineer, data-modeler, mobile-engineer.
The council recommends; it does not implement. Avishek makes the call._

## 1. Decision

**BUILD.** Extend the existing Spring Boot + MongoDB REST API with a hand-rolled delta-sync layer; do not adopt PowerSync or ElectricSQL. The concrete shape for a single subscriber-only user, now:

- **Delta-read**: `GET /api/{collection}/changes?since=<cursor>` per collection (workouts first), paginated by a compound `(userId, updatedAt)` cursor with an `_id` tie-break (never `updatedAt` alone), returning changed docs **and** `deletedAt` tombstones, over the unchanged Decimal128-as-string wire contract.
- **Optimistic-lock enforcement**: turn the already-present `@Version` field into a real `If-Match` precondition (`version.is(expectedVersion)` ANDed into the update; `modifiedCount==0` → HTTP 409 with the server's current doc).
- **Client outbox**: extend the shipped `LocalStore` seam from its settings-only KV table into (a) a **document-shaped** local mirror per collection and (b) a `pending_ops` outbox that replays on reconnect. Client-minted `_id` (DESIGN.md #5) makes POST-replay idempotent for free.
- Gate the whole thing behind the `SYNC_ENABLED` + `subscribed` flag DEPLOY.md Phase 2 already scoped, ahead of Stripe.

No new infra, no new deploy component, no Atlas tier change - it rides the existing tenant-isolation choke point and JWT auth on the one OCI VM.

## 2. Consensus

All four seats reached **BUILD unanimously**, and independently:

- **ElectricSQL is disqualified outright** - it syncs off Postgres logical replication and has no MongoDB path. Adopting it is a full DB + data-model migration in disguise (decompose the embedded session-as-document aggregate, drop Decimal128, rewrite every tenant-isolation query and `$jsonSchema` validator).
- **PowerSync is over-built for the workload** - its MongoDB connector is real, but it means a second production service for ~1 user, a bucket/sync-rules DSL that re-implements tenant isolation *outside* the Spring repo layer (DESIGN.md calls the `userId`-ANDed query pattern "the entire security story... no RLS backstop" - duplicating it across two systems in a language `ApiIntegrationTest` cannot reach is the exact drift that has bitten this codebase), and a relational on-device schema that fights the shipped SQLite-WASM `LocalStore` seam.
- **The backend already carries the primitives** hand-rolled delta-sync needs (`updatedAt`, `deletedAt`, `@Version`, `schemaVersion`, stable `setId`); the gap is three additive pieces, not a redesign. DESIGN.md §8 pre-scoped this as "a non-migration."
- **Conflict model is last-write-wins, not CRDT** (see §4). Single subscriber across their own devices is sequential, not concurrent-multi-writer.
- **A confirmed live bug**, independent of the sync decision: `WorkoutRepository.updateSet` (line 87) does `.inc("version", 1)` **unconditionally with no precondition** - so today it *records* that a lost update happened without *detecting* it. Verified directly, along with `@Version` living on **only** `Workout` and `Macrocycle`.
- **Sync needs the same eval discipline as the rest of this codebase**: an `S##` invariant catalog (delta-read pagination, outbox replay, tombstone retention) pinned failing-test-first, treated as a **ship gate**, not follow-up - matching R1-R40 and the tenant-isolation suite.

## 3. Dissent

Real disagreements, preserved:

- **Effort estimate (backend-engineer vs systems-architect + mobile-engineer).** systems-architect ("few days" for delta-read) and mobile-engineer ("a few weeks", delta-read "a few days") center the delta-read endpoint. **backend-engineer contests this and holds 1.5-2 weeks backend-only**, arguing the load-bearing cost is the `If-Match` retrofit across **8 mutating endpoints in 5 controllers** (only the Workout full-PUT has real locking today), each needing a stale-version-409 integration test - "delta-read is cheap; the version audit is the actual critical path." systems-architect concedes this and elevates the audit to its own milestone.

- **Local mirror shape (mobile-engineer vs data-modeler).** data-modeler proposes decomposing the mirror into **relational SQLite tables** (workouts/sets/exercises/templates/splits with FKs). **mobile-engineer contests this as self-inflicting the exact "second schema in lockstep" drift data-modeler used to reject PowerSync** - and instead argues for a **document-shaped mirror** (one row per aggregate: `id, collection, json, updatedAt, deletedAt, version`), so a server-side additive/nullable field flows through the JSON blob with no client migration; cross-set queries run in JS at N=1 data volume. *The chair sides with mobile-engineer here* - the document-shaped mirror preserves the additive-only invariant and the expo-sqlite portability seam.

- **`@Version` backfill is NOT a trivial additive field (data-modeler, solo and load-bearing).** data-modeler warns that Spring Data MongoDB branches insert-vs-update on the `@Version` property: an existing doc with no version deserializes to `null` and the next save is treated as a **new** entity (duplicate-key error or a silently reset counter that defeats the lock). So adding `@Version` to Exercise/Template/Split requires a **real backfill** (`version = 0` on every existing doc via an idempotent startup step), not just annotating the class. No other seat raised this; it is the sharpest correction of the round and must gate the Phase-2 extension.

- **409 resolution UX is unresolved (backend-engineer + systems-architect).** Both reject the "server wins, client refetches" framing (data-modeler, mobile-engineer) as under-specified: a bare 409 that **drops the losing device's edit is a data-loss bug wearing a conflict-resolution costume**. They require the outbox to carry the full mutation so the client can **rebase-and-retry once** before surfacing a prompt. Whether Phase-1 ships a "keep mine / keep server's" UI or punts it to Phase-2b is named as an **open product decision**, not something LWW already solves.

## 4. Conflict resolution

**Whole-document / aggregate-level last-write-wins, keyed on `updatedAt`, backstopped by `@Version` as an `If-Match` optimistic lock.** This is the settings-slice model (`settingsUpdatedAt` epoch-ms LWW) generalized - a proven, shipped reference implementation. A stale write gets a 409 with the server's current copy; the client **rebases (re-applies its local delta on top) and retries once**, then prompts only on a genuine second collision.

Explicitly **not** field-level CRDT/OT merge. That machinery solves concurrent-multi-editor collision across many writers - a problem this product does not have (one person, sequential device use). Paying its complexity and ops cost now buys headroom the feature will not use, which the "do not over-build for scale that is not here" constraint forbids.

**Revisit the conflict model when** usage becomes genuinely multi-device-concurrent or multi-user (real-time collaboration, shared logs, coaching handoff) - at which point CRDT-grade merge, and possibly a purpose-built engine, earns its cost.

## 5. Migration & sequencing

From where the code sits today (hooks present: `updatedAt`, `deletedAt` on Workout+Exercise, `@Version` on Workout+Macrocycle only, `schemaVersion`, stable `setId`; `LocalStore` KV seam):

- **Phase 0 - Fix the confirmed gap + pin invariants (prerequisite).** Add `version.is(expectedVersion)` precondition to `WorkoutRepository.updateSet`; author the `S##` delta-sync/outbox eval catalog (pagination boundary at identical `updatedAt`, tombstone inclusion, outbox partial-replay, double-apply, clock-skew ordering, tombstone-retention growth) as failing-guard-first tests **before** any client wiring.
- **Phase 1 - Workouts-only spike (both hooks already correct here).** Add the `(userId, updatedAt)` compound index; ship `GET /api/workouts/changes?since=` reusing the tenant-scoped `owned()` query builder, returning tombstones; wire `If-Match`/409 on the Workout write paths; extend `LocalStore` with a **document-shaped** workouts mirror + `pending_ops` outbox; prove the pull-then-push loop with a stale-version-409 `ApiIntegrationTest`. Decide the **409 resolution UX** (rebase-retry only, or retry + prompt) here.
- **Phase 2 - Version-audit milestone (backend-engineer's critical path).** Controller-by-controller audit of all 8 mutating endpoints across WorkoutController/ExerciseController/SplitController/TemplateController/MeController; retrofit each to check-and-increment; one stale-version-409 test per endpoint. **Prerequisite sub-steps**: (a) `@Version` **backfill** (`version = 0`) on every existing Exercise/Template/Split doc via an idempotent `MongoSchemaInitializer` step *before* the annotation is trusted (the insert-vs-update trap); (b) add `deletedAt` to WorkoutTemplate and Split (they have none today - delete-propagation for those collections does not exist yet).
- **Phase 3 - Extend delta-read + mirror** to exercises/templates/splits/plan; decide the **tombstone-retention window** (open in DESIGN.md §8, entangled with GDPR hard-delete since `rawImport` embeds original-row PII).
- **Phase 4 - Gate** the whole loop behind `SYNC_ENABLED` + `subscribed`, ahead of Stripe.

Every step is additive, independently testable, and reversible; worst case is a few unused endpoints, not a database migration. Invariants pass through untouched: tenant isolation stays the single choke point, weights stay Decimal128-as-string, `setId` stays `setId`, all new fields are additive/nullable (with the `@Version` backfill as the one non-trivial exception, handled in Phase 2).

## 6. Risks & open questions

**Biggest risk of BUILD (chosen path):** hand-rolled sync is easy to get 80% right and silently wrong at the edges - pagination boundary collisions at identical `updatedAt`, outbox partial-replay after a crash double-applying or dropping a logged set, unswept tombstones growing the delta feed unbounded, clock-skew corrupting LWW ordering across devices. This is precisely the silent-correctness bug class this codebase's history predicts (Decimal128 float-drift, non-deterministic top working set). **Mitigation is non-optional**: the `S##` eval catalog as a ship gate, and the version-check audit completed across all 8 endpoints - because outbox idempotency for PATCH/PUT replay is entirely downstream of `If-Match` being wired everywhere (client-minted `_id` only buys POST idempotency).

**Biggest risk of ADOPT (rejected path):** the "integration cost" line item is categorically larger than it looks. ElectricSQL is a full Mongo-to-Postgres database migration (rewrite the embedded aggregate, Decimal128 handling, tenant queries, `$jsonSchema` validators). PowerSync is a second production service reversing the single-service ops-shrink, plus a bucket/sync-rules DSL that **duplicates tenant isolation** in a language the existing security test suite cannot reach - splitting "the entire security story" across two systems for one subscriber.

**Open questions to resolve before building:** (1) Phase-1 conflict UX - rebase-retry only, or retry-plus-"keep mine / keep server's" prompt? (2) tombstone-retention window, entangled with GDPR hard-delete of `rawImport` PII. (3) confirm `Macrocycle.advance()`'s save path actually exercises `@Version` under mutation (assumed, not audited).

## 7. Next steps (recommend-only - Avishek decides)

1. **Land Phase 0 as a standalone hardening PR now, decoupled from any sync commitment**: add the missing `version.is(expectedVersion)` precondition to `WorkoutRepository.updateSet` with a stale-version-409 test. It is a confirmed live lost-update bug worth fixing regardless of the sync verdict.
2. **Commission the version-audit spec**: an `eval-engineer`/`backend-engineer` sub-agent enumerates all 8 mutating endpoints, notes current locking status, and sizes the `@Version` backfill for Exercise/Template/Split - so the effort disagreement (1-1.5 vs 1.5-2 weeks) is resolved with a real count, not an estimate.
3. **Draft the `S##` invariant catalog** (delta-read pagination, tombstone inclusion/retention, outbox replay idempotency, clock-skew LWW ordering) as failing-guard-first tests, mirroring how R1-R40 gate the coaching engine - this is the ship gate, so it should exist before code.
4. **Decide the two open product questions** - Phase-1 409 UX and tombstone-retention/GDPR window - since both shape the schema and the outbox contract.
5. **Then, if greenlit**, sequence the workouts-only spike (Phase 1) as the proof, and only extend to other collections after the `@Version` backfill and `deletedAt` additions land.
