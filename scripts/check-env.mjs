// Says which of Buddy's settings are set, and flags mistakes (stage 39).
// Never prints a value, so its output is safe to share.
//
//   npm.cmd run check-env              checks .env.local on this computer
//   npm run check-env -- --live        checks as a live server would run it
//
// On a hosting service the settings live in its dashboard, not in .env.local;
// this command reads both (what is in the environment wins, like Next.js).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkEnv, parseEnvFile } from "./check-env-plan.mjs";

const live = process.argv.includes("--live");
const file = path.join(process.cwd(), ".env.local");
const fromFile = existsSync(file) ? parseEnvFile(readFileSync(file, "utf8")) : {};
const vars = { ...fromFile };
for (const [name, value] of Object.entries(process.env)) {
  if (name in fromFile || name.startsWith("NEXT_PUBLIC_") || name.startsWith("BUDDY_") || /^(GEMINI|ANTHROPIC|GOOGLE|GMAIL)_/.test(name)) {
    if (value !== undefined && value !== "") vars[name] = value;
  }
}

const { rows, errors, warnings } = checkEnv(vars, { live });

console.log(`Buddy settings (${existsSync(file) ? ".env.local" : "no .env.local found"}${live ? ", checked as a live server" : ""})`);
console.log("Only the two Supabase settings are required; the others switch on optional features. Values are never shown.\n");
let group = "";
for (const row of rows) {
  if (row.group !== group) {
    group = row.group;
    console.log(`${group}:`);
  }
  console.log(`  ${row.set ? "set    " : "missing"}  ${row.name}${row.secret ? "  (secret)" : ""}`);
}

if (errors.length) {
  console.log("\nMust fix:");
  for (const message of errors) console.log(`  - ${message}`);
}
if (warnings.length) {
  console.log("\nWorth a look:");
  for (const message of warnings) console.log(`  - ${message}`);
}
console.log(errors.length ? "\nSome settings need fixing (see above)." : "\nNo problems found.");
process.exit(errors.length ? 1 : 0);
