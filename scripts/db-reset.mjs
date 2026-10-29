// Resets the hosted database (owner: JT, task JT-08, D-JT21-1): deletes every event, evidence
// snapshot and finalized record. The app seeds the demo events again on its next request.
//
//   npm run db:reset              asks you to type RESET
//   CONFIRM=RESET npm run db:reset    no prompt (used by the "Reset database" GitHub Action)
//
// Reads DATABASE_URL from the environment, or from .env.local when it is there.
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (environment or .env.local). Nothing was reset.");
  process.exit(1);
}

let confirm = process.env.CONFIRM;
if (confirm === undefined) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const host = new URL(url).host;
  confirm = await rl.question(`This deletes every event in ${host}. Type RESET to continue: `);
  rl.close();
}
if (confirm.trim() !== "RESET") {
  console.error("Not confirmed. Nothing was reset.");
  process.exit(1);
}

const sql = neon(url);
const tables = ["events", "snapshots", "finalized_events"];
const existing = (
  await sql.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`, [
    tables,
  ])
).map((r) => r.table_name);
if (existing.length === 0) {
  console.log("No FieldDay tables yet. Nothing to reset.");
} else {
  await sql.query(`TRUNCATE ${existing.join(", ")}`);
  console.log(`Reset: emptied ${existing.join(", ")}. The demo events are seeded again on the app's next request.`);
}
