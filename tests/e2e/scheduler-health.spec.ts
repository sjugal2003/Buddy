import { expect, test } from "@playwright/test";
import pg from "pg";
import { createOrg, hidden, signUpAndConfirm, stamp } from "./helpers";

/** Logs a scheduled check the way the 15-minute job does, failed or not, in the local test database only. */
async function logScheduledCheck(slug: string, error: string | null) {
  const client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
  await client.connect();
  try {
    const { rows } = await client.query(
      `insert into public.escalation_runs (organization_id, source, finished_at)
       select id, 'scheduled', now() from public.organizations where slug = $1 returning id`,
      [slug],
    );
    // Failures are recorded by updating the run, as private.run_escalation_check does.
    if (error) await client.query("update public.escalation_runs set error = $2 where id = $1", [rows[0].id, error]);
  } finally {
    await client.end();
  }
}

// What a failing automatic check looks like (rules in supabase/tests/security_test.sql):
// a notification for the owner and a clear line in Settings, which clears once
// a check succeeds again.

test("scheduler health: a failed automatic check is reported, then clears", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `sched-${id}`;
  const W = `/w/${slug}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `sched${id}@example.com`);
  await createOrg(p, "Sched Co", slug);

  await test.step("a failed scheduled check notifies the owner", async () => {
    await logScheduledCheck(slug, "canceling statement due to statement timeout");
    await p.goto(`${W}/notifications`);
    await expect(p.getByTestId("notification-count")).toHaveText("1");
    const item = p.getByTestId("notification-item").filter({ hasText: "The automatic escalation check failed." });
    await expect(item.getByRole("link")).toHaveAttribute("href", `${W}/settings`);
  });

  await test.step("Settings says the last automatic check failed", async () => {
    await p.goto(`${W}/settings`);
    await expect(p.getByTestId("automatic-checks")).toContainText(
      "Running every 15 minutes, but the last automatic check failed: canceling statement due to statement timeout",
    );
    await expect(p.getByTestId("automatic-checks")).toContainText("No automatic check has succeeded in the last hour.");
    await expect(p.getByTestId("automatic-last-success")).toHaveText("Last successful scheduled check: none yet");
  });

  await test.step("a second failure the same day adds no notification", async () => {
    await logScheduledCheck(slug, "Again.");
    await p.goto(`${W}/notifications`);
    await expect(p.getByTestId("notification-item")).toHaveCount(1);
  });

  await test.step("a successful check clears the warning", async () => {
    await logScheduledCheck(slug, null);
    await p.goto(`${W}/settings`);
    await expect(p.getByTestId("automatic-checks")).toContainText("Running every 15 minutes.");
    await expect(p.getByTestId("automatic-checks")).not.toContainText("failed");
    await hidden(p, '[data-testid="automatic-last-success"]');
  });
});
