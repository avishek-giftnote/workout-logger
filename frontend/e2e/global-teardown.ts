import { execSync } from "node:child_process";

/**
 * Drop the e2e run's database on finish so local Atlas runs stop leaking `workoutlogger_e2e`-style
 * databases (see docs/db-situation.md). Best-effort and deliberately dependency-free (shells out to
 * `npx mongosh`), and GATED to a remote host: CI's `mongo:7` service container is ephemeral and localhost,
 * so this is a no-op there (no mongosh download, no teardown needed). Never throws — a failed cleanup just
 * means a DB to drop by hand, not a failed test run.
 */
export default function globalTeardown() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes("localhost") || uri.includes("127.0.0.1")) return;   // CI / no managed DB → skip
  const dbName = (uri.split("/").pop() ?? "").split("?")[0];
  if (!dbName.startsWith("workoutlogger_")) return;                             // never the bare dev DB
  try {
    execSync(`npx -y mongosh "${uri}" --quiet --eval "db.getSiblingDB('${dbName}').dropDatabase()"`,
      { stdio: "ignore", timeout: 120_000 });
    console.log(`[e2e teardown] dropped ${dbName}`);
  } catch {
    /* best-effort — leave a note, never fail the run */
    console.warn(`[e2e teardown] could not drop ${dbName} (drop it manually if it leaked)`);
  }
}
