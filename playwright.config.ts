import { execSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

// Browser tests run against the LOCAL Supabase started with
// `npx supabase start`, never the hosted project: the settings below replace
// the values from .env.local for the test server only.
const PORT = 3100;

function pointAtLocalSupabase() {
  if (process.env.E2E_MAIL_URL) return; // already done (Playwright loads this file more than once)
  let output: string;
  try {
    output = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    throw new Error("Local Supabase is not running. Start Docker Desktop, then run: npx supabase start");
  }
  const vars = Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
  const url = vars.API_URL;
  const key = vars.PUBLISHABLE_KEY || vars.ANON_KEY;
  const mail = vars.MAILPIT_URL || vars.INBUCKET_URL;
  if (!url || !key || !mail || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error("Could not read the local Supabase settings from `npx supabase status`.");
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
  process.env.E2E_MAIL_URL = mail;
}

pointAtLocalSupabase();

export default defineConfig({
  testDir: "tests/e2e",
  // One company per test file, and one file at a time: the local email
  // catcher and sign-up limits are shared.
  workers: 1,
  fullyParallel: false,
  timeout: 5 * 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // CI tests the production build (some bugs only show there); on your
    // computer the dev server is quicker to start.
    command: process.env.CI ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      // Tests use the free keyword analyser and never the paid AI, even when
      // .env.local on this computer has a real key.
      BUDDY_AI_MODE: "fake",
      ANTHROPIC_API_KEY: "",
    },
  },
});
