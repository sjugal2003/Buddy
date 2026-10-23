// Runs supabase/tests/security_test.sql against the LOCAL Supabase database
// (started with `npx supabase start`). The script rolls itself back, so it
// leaves no data behind. It refuses any database that isn't on this computer.
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error("test:db only runs against a local database. Unset TEST_DATABASE_URL or point it at 127.0.0.1.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
const verbose = process.argv.includes("--verbose");
client.on("notice", (n) => verbose && console.log(n.message));

try {
  await client.connect();
} catch {
  console.error("Could not reach the local database. Start it first with: npx supabase start");
  process.exit(1);
}

try {
  const results = await client.query(readFileSync("supabase/tests/security_test.sql", "utf8"));
  const summary = results.flatMap((r) => r.rows ?? []).find((row) => typeof row.result === "string");
  console.log(summary?.result ?? "Finished, but the summary row was missing.");
  if (!summary) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
