#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiError, createApi, resolveLocalToken, type WorkoutApi } from "./api.js";
import {
  createExerciseShape, createPlanShape, exerciseIdShape, idShape, logWorkoutShape,
  mesoInputShape, setBodyweightShape, updateProfileShape,
} from "./schemas.js";

// stdio transport uses STDOUT as the protocol channel — every diagnostic MUST go to stderr,
// or it corrupts the JSON-RPC stream. Never console.log in this process.
const logErr = (...a: unknown[]) => console.error("[workout-logger-mcp]", ...a);

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  const text = data === undefined ? "OK (no content)" : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Turn any thrown error into a readable tool error the model can reason about. */
function wrap(fn: () => Promise<unknown>): Promise<ToolResult> {
  return fn().then(ok).catch((e): ToolResult => {
    const msg =
      e instanceof ApiError
        ? `API error ${e.status}: ${e.message}${e.detail ? ` (${JSON.stringify(e.detail)})` : ""}`
        : `Error: ${(e as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  });
}

const READ = { readOnlyHint: true } as const;
const WRITE = { readOnlyHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

export function registerTools(server: McpServer, api: WorkoutApi): void {
  // ---- reads ----
  server.registerTool("get_profile",
    { title: "Get profile", description: "The signed-in user: email, current bodyweight, bodyweight log, and profile (age/height/sex/goal/activity).", inputSchema: {}, annotations: READ },
    () => wrap(() => api.me()));

  server.registerTool("get_energy_estimate",
    { title: "Get energy estimate", description: "Read-time surplus/deficit estimate from the deterministic EnergyService (Mifflin–St Jeor × PAL + weight-trend slope, with data-sufficiency gates and a confidence tier). Use THIS instead of guessing the user's energy balance from raw weigh-ins.", inputSchema: {}, annotations: READ },
    () => wrap(() => api.energy()));

  server.registerTool("get_active_plan",
    { title: "Get active plan", description: "The user's current macrocycle (mesocycles, current meso index + week, goal, target date), or null if none.", inputSchema: {}, annotations: READ },
    () => wrap(() => api.getPlan()));

  server.registerTool("get_plan_history",
    { title: "Get plan history", description: "All completed/ended macrocycles for the user, newest first.", inputSchema: {}, annotations: READ },
    () => wrap(() => api.planHistory()));

  server.registerTool("list_exercises",
    { title: "List exercises", description: "The user's exercise catalog (name, equipment, muscle contributions, laterality, mechanic). Resolve names to exerciseId here before logging.", inputSchema: {}, annotations: READ },
    () => wrap(() => api.listExercises()));

  server.registerTool("last_working_set",
    { title: "Last working set", description: "The most recent WORKING set for an exercise (weight/reps/rpe) — the 'last time' seed for the next session.", inputSchema: exerciseIdShape, annotations: READ },
    ({ exerciseId }) => wrap(() => api.lastWorkingSet(exerciseId)));

  server.registerTool("list_workouts",
    { title: "List workouts", description: "All logged sessions for the user, each with embedded exercise blocks and sets. Weights are decimal strings.", inputSchema: {}, annotations: READ },
    () => wrap(() => api.listWorkouts()));

  server.registerTool("get_workout",
    { title: "Get workout", description: "One workout session by id (embedded exercises + sets).", inputSchema: idShape, annotations: READ },
    ({ id }) => wrap(() => api.getWorkout(id)));

  server.registerTool("list_templates",
    { title: "List templates", description: "The user's workout templates.", inputSchema: {}, annotations: READ },
    () => wrap(() => api.listTemplates()));

  server.registerTool("list_splits",
    { title: "List splits", description: "The user's training splits (ordered template ids + weekday assignments).", inputSchema: {}, annotations: READ },
    () => wrap(() => api.listSplits()));

  // ---- workout writes ----
  server.registerTool("log_workout",
    { title: "Log a workout", description: "Create a new workout session. Provide startedAt (ISO) and one exercise block per movement, each with ordered sets. Weights/loadDelta are decimal STRINGS (e.g. \"82.5\"), never numbers. Resolve exercise names to exerciseId via list_exercises first.", inputSchema: logWorkoutShape, annotations: WRITE },
    (args) => wrap(() => api.createWorkout(args)));

  server.registerTool("update_workout",
    { title: "Update a workout", description: "Replace a workout session by id with a full new body (same shape as log_workout plus the id).", inputSchema: { ...idShape, ...logWorkoutShape }, annotations: WRITE },
    ({ id, ...body }) => wrap(() => api.updateWorkout(id, body)));

  server.registerTool("delete_workout",
    { title: "Delete a workout", description: "Permanently delete a workout session by id. Irreversible — confirm with the user before calling.", inputSchema: idShape, annotations: DESTRUCTIVE },
    ({ id }) => wrap(() => api.deleteWorkout(id)));

  // ---- profile / bodyweight writes ----
  server.registerTool("set_bodyweight",
    { title: "Set bodyweight", description: "Record a bodyweight entry (kg as a decimal string). Feeds the energy estimate and bodyweight-load math.", inputSchema: setBodyweightShape, annotations: WRITE },
    ({ weightKg, recordedAt }) => wrap(() => api.setBodyweight(weightKg, recordedAt ?? undefined)));

  server.registerTool("update_profile",
    { title: "Update profile", description: "Update age/height/sex/goal/activity level. Height is a decimal string (cm). These feed the Mifflin–St Jeor energy estimate.", inputSchema: updateProfileShape, annotations: WRITE },
    (args) => wrap(() => api.updateProfile(args)));

  // ---- plan writes ----
  server.registerTool("create_plan",
    { title: "Create plan", description: "Create the active macrocycle from an ordered list of mesocycles. Prefer building this from the periodization planner's output rather than inventing volume/phases.", inputSchema: createPlanShape, annotations: WRITE },
    (args) => wrap(() => api.createPlan(args)));

  server.registerTool("advance_plan",
    { title: "Advance plan", description: "Advance the active plan by one step (week → deload → next mesocycle).", inputSchema: {}, annotations: WRITE },
    () => wrap(() => api.advancePlan()));

  server.registerTool("add_mesocycle",
    { title: "Add mesocycle", description: "Append a mesocycle to the active plan.", inputSchema: mesoInputShape, annotations: WRITE },
    (args) => wrap(() => api.addMesocycle(args)));

  server.registerTool("end_plan",
    { title: "End plan", description: "End the active plan early (marks it ENDED). The plan is retained in history but no longer active. Confirm with the user first.", inputSchema: {}, annotations: DESTRUCTIVE },
    () => wrap(() => api.endPlan()));

  // ---- catalog writes ----
  server.registerTool("create_exercise",
    { title: "Create exercise", description: "Add an exercise to the user's catalog.", inputSchema: createExerciseShape, annotations: WRITE },
    (args) => wrap(() => api.createExercise(args)));

  server.registerTool("restore_default_exercises",
    { title: "Restore default exercises", description: "Back-fill the 84 default exercises the user is missing. Additive; returns how many were added.", inputSchema: {}, annotations: WRITE },
    () => wrap(() => api.restoreDefaultExercises()));
}

async function main(): Promise<void> {
  const baseUrl = (process.env.WORKOUT_LOGGER_API_URL ?? "http://localhost:8080/api").replace(/\/$/, "");
  const getToken = await resolveLocalToken(baseUrl);
  const api = createApi({ baseUrl, getToken });

  const server = new McpServer({ name: "workout-logger", version: "0.1.0" });
  registerTools(server, api);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logErr(`ready — API ${baseUrl}`);
}

// Only run when invoked as the entry point (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    logErr("fatal:", (e as Error).message);
    process.exit(1);
  });
}
