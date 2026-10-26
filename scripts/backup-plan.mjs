// The pieces of a backup (see scripts/backup.mjs). Kept apart so unit tests
// can check them without running anything.

/** A folder name like 2026-11-02_0930 (this computer's local time), which sorts by date. */
export function backupFolderName(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

/** The `supabase db dump` runs, in order, as Supabase's backup guide does them. */
export function backupSteps(local) {
  const target = local ? "--local" : "--linked";
  return [
    { label: "Database roles", file: "roles.sql", args: ["supabase", "db", "dump", target, "--role-only"] },
    { label: "Structure", file: "schema.sql", args: ["supabase", "db", "dump", target] },
    // Only Buddy's own rows and the sign-ins; Supabase's internal schemas
    // (storage and others Buddy doesn't use) can't be restored by a project
    // owner anyway.
    {
      label: "Data",
      file: "data.sql",
      args: ["supabase", "db", "dump", target, "--data-only", "--use-copy", "--schema", "auth,public,private"],
    },
  ];
}
