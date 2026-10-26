import { createHash } from "node:crypto";
import pg from "pg";
import { TEST_AI_RESULT_KEY, TEST_DB } from "./helpers";

// Runs once before the browser tests: tells the LOCAL test database the hash
// of the test server's AI result key (playwright.config.ts), the same step
// the README describes for a real project.
export default async function globalSetup() {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    const hash = createHash("sha256").update(TEST_AI_RESULT_KEY, "utf8").digest("hex");
    await client.query("update private.platform_settings set ai_result_key_hash = $1", [hash]);
  } finally {
    await client.end();
  }
}
