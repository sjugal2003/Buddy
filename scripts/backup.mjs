// Saves a copy of Buddy's database into backups/<date>_<time>/ (stage 38).
//
//   npm.cmd run backup            the hosted project linked with `supabase link`
//   npm run backup -- --local     the local test database (for trying it out)
//
// It runs Supabase's own `supabase db dump` three times: the database roles,
// the structure (tables, functions, rules) and the data. That tool needs
// Docker Desktop running. It asks for the database password if Supabase
// doesn't already know it. Nothing is uploaded anywhere: the files stay on
// this computer, and the backups folder is kept out of Git. The files hold
// customer data and the encrypted Gmail token, so keep them private.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { backupFolderName, backupSteps } from "./backup-plan.mjs";

const local = process.argv.includes("--local");
const root = process.cwd();

if (!local && !existsSync(path.join(root, "supabase", ".temp", "project-ref"))) {
  console.error("This folder isn't linked to your Supabase project yet. Run `npx.cmd supabase link` first (see the README).");
  process.exit(1);
}

const folder = path.join(root, "backups", backupFolderName(new Date()));
mkdirSync(folder, { recursive: true });
console.log(`Saving a backup of the ${local ? "local test" : "hosted"} database into ${folder}`);

const isWindows = process.platform === "win32";
for (const step of backupSteps(local)) {
  const file = path.join(folder, step.file);
  console.log(`\n${step.label}...`);
  // Fixed arguments only; Windows needs the shell to run npx.cmd.
  const result = spawnSync(isWindows ? "npx.cmd" : "npx", [...step.args, "--file", file], {
    stdio: "inherit",
    shell: isWindows,
  });
  if (result.status !== 0 || !existsSync(file)) {
    console.error(`\nThe backup stopped at "${step.label}". Is Docker Desktop running? See "Backups" in docs/RUNBOOK.md.`);
    process.exit(1);
  }
  console.log(`Saved ${step.file} (${Math.max(1, Math.round(statSync(file).size / 1024))} KB)`);
}

writeFileSync(
  path.join(folder, "README.txt"),
  [
    "Buddy database backup",
    `Made: ${new Date().toISOString()} from the ${local ? "local test" : "hosted"} database.`,
    "",
    "roles.sql   database roles",
    "schema.sql  tables, functions and access rules",
    "data.sql    the rows (customer data, and the encrypted Gmail token)",
    "",
    "Keep this folder private. To restore it, follow \"Restore the database from a backup\" in docs/RUNBOOK.md.",
    "",
  ].join("\r\n"),
);

console.log(`\nBackup finished: ${folder}`);
