---
description: Rebuild the dev database from the Strong CSV via the one-time importer.
---

Re-import the Strong export into a fresh dev DB using the backend importer (Spring `import` profile). Use this after a data-shape change. Per `CLAUDE.md` → Commands.

1. Make sure MongoDB is reachable (`MONGODB_URI`, default `mongodb://localhost:27017/workoutlogger`). If it isn't, stop and say so — don't proceed.
2. From `cd backend`, first a **dry run** (parse + assert, no DB): `mvn spring-boot:run -Dspring-boot.run.profiles=import`
3. If the dry run's counts look right, **persist**: set `IMPORT_USER_PASSWORD` (and `IMPORT_CSV` / `IMPORT_BODYWEIGHT` if non-default), then `mvn spring-boot:run -Dspring-boot.run.profiles=import -Dspring-boot.run.arguments="--importer.persist=true"`
4. Restart the API (`mvn spring-boot:run`) so it picks up the new shape, and report the imported session/set counts.

If `$ARGUMENTS` overrides the CSV path or user, use that. Never import real personal data into anything outside this local dev DB.
