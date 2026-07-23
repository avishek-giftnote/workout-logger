// Boots the built server over stdio, completes the MCP handshake, and lists the registered
// tools. No backend required — WORKOUT_LOGGER_TOKEN short-circuits the identity provider, and
// tools/list makes no API calls. Verifies the server starts and the tool surface is intact.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/server.js"],
  env: { ...process.env, WORKOUT_LOGGER_TOKEN: "smoke-dummy-token" }, // pragma: allowlist secret
  stderr: "inherit",
});

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`\ntools registered (${tools.length}):`);
for (const t of tools.sort((a, b) => a.name.localeCompare(b.name))) {
  const ro = t.annotations?.readOnlyHint ? "read " : t.annotations?.destructiveHint ? "DEL  " : "write";
  console.log(`  [${ro}] ${t.name}`);
}
await client.close();
if (tools.length === 0) { console.error("no tools registered"); process.exit(1); }
console.log("\nsmoke OK");
