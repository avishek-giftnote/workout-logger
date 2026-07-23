// Live end-to-end verification: MCP server → REST API → Mongo → back.
// Needs a running backend (WORKOUT_LOGGER_API_URL) and a token (WORKOUT_LOGGER_TOKEN).
// Exercises a read, the deterministic energy tool, a write (log_workout), and a read-back.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert";

const token = process.env.WORKOUT_LOGGER_TOKEN; // pragma: allowlist secret
assert(token, "set WORKOUT_LOGGER_TOKEN");

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/server.js"],
  env: { ...process.env },
  stderr: "inherit",
});
const client = new Client({ name: "verify-live", version: "0.0.0" });
await client.connect(transport);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  if (r.isError) throw new Error(`${name} -> ${text}`);
  try { return JSON.parse(text); } catch { return text; } // 204 writes return "OK (no content)"
};

// 1) read: the seeded catalog
const exercises = await call("list_exercises");
console.log(`✓ list_exercises -> ${exercises.length} exercises`);
const strength = exercises.find((e) => e.category === "STRENGTH" && e.equipment !== "BODYWEIGHT") ?? exercises[0];
assert(strength, "no exercise to log against");

// 2) read: the deterministic engine (fresh account -> gated)
const energy = await call("get_energy_estimate");
console.log(`✓ get_energy_estimate -> status=${energy.status} phase=${energy.phase} confidence=${energy.confidence}`);

// 3) write: log a workout with a decimal-STRING weight
const startedAt = process.env.VERIFY_STARTED_AT ?? "2026-07-21T18:30:00Z";
const logged = await call("log_workout", {
  startedAt,
  exercises: [{
    exerciseId: strength.id,
    name: strength.name,
    position: 0,
    sets: [{ orderIndex: 0, setType: "WORKING", weight: "82.5", reps: 5, rpe: 8 }],
  }],
});
console.log(`✓ log_workout -> workout ${logged.id}`);

// 4) read-back: it persisted AND the weight is a STRING, not a rounded number
const workouts = await call("list_workouts");
const found = workouts.find((w) => w.id === logged.id);
assert(found, "logged workout not found on read-back");
const w = found.exercises[0].sets[0].weight;
assert.strictEqual(w, "82.5", `weight round-tripped as ${JSON.stringify(w)} (type ${typeof w}) — expected string "82.5"`);
console.log(`✓ read-back: weight = ${JSON.stringify(w)} (${typeof w}) — decimal-string invariant holds`);

// 5) clean up the throwaway workout so we don't litter the account
await call("delete_workout", { id: logged.id });
console.log(`✓ delete_workout -> cleaned up ${logged.id}`);

await client.close();
console.log("\nLIVE VERIFY OK — MCP ↔ REST ↔ Mongo round-trip confirmed");
