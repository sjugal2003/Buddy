import { expect, test } from "@playwright/test";
import pg from "pg";
import { acceptInvite, createOrg, hidden, inviteLink, shows, signUpAndConfirm, stamp, TEST_DB } from "./helpers";

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

/**
 * Adds a run of the daily clean-up to pg_cron's history in the local test
 * database only, as if it had run just now. Returns its id so it can be removed.
 */
async function logCleanupRun(status: "succeeded" | "failed") {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    const { rows } = await client.query(
      // Ids far above pg_cron's own, which this role can't take from its sequence.
      `insert into cron.job_run_details (runid, jobid, database, username, command, status, return_message, start_time, end_time)
       select (select coalesce(max(runid), 0) + 1000000 from cron.job_run_details), jobid, 'postgres', 'postgres',
         command, $1, '', now(), now()
       from cron.job where jobname = 'buddy-daily-cleanup'
       returning runid`,
      [status],
    );
    return rows[0].runid as string;
  } finally {
    await client.end();
  }
}

async function removeCleanupRuns(ids: string[]) {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    await client.query("delete from cron.job_run_details where runid = any($1::bigint[])", [ids]);
  } finally {
    await client.end();
  }
}

// Stage 38: the health page for an uptime checker, and Settings showing
// whether the daily clean-up ran (rules in supabase/tests/security_test.sql).

test("health page answers, and owners see whether the daily clean-up ran", async ({ browser, baseURL, request }) => {
  const id = stamp();
  const slugA = `cleanup-a-${id}`;
  const slugB = `cleanup-b-${id}`;
  const runs: string[] = [];

  await test.step("the health page says ok, with nothing private and no caching", async () => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
    expect(response.headers()["cache-control"]).toContain("no-store");
  });

  const owner = await signUpAndConfirm(browser, baseURL!, "Olga Owner", `cleanup-owner${id}@example.com`);
  await createOrg(owner, "Cleanup Co", slugA);

  try {
    await test.step("an owner sees the daily clean-up in Settings", async () => {
      await owner.goto(`/w/${slugA}/settings`);
      await shows(owner, "text=Scheduled jobs");
      await expect(owner.getByTestId("daily-cleanup-status")).toContainText(/hasn't run yet|Working\. Last run/);
    });

    await test.step("a failed run shows in red, and a later success clears it", async () => {
      runs.push(await logCleanupRun("failed"));
      await owner.goto(`/w/${slugA}/settings`);
      await expect(owner.getByTestId("daily-cleanup-status")).toContainText("The last run failed");
      await expect(owner.getByTestId("daily-cleanup-status")).toHaveClass(/text-red-700/);
      runs.push(await logCleanupRun("succeeded"));
      await owner.goto(`/w/${slugA}/settings`);
      await expect(owner.getByTestId("daily-cleanup-status")).toContainText("Working. Last run");
      await expect(owner.getByTestId("daily-cleanup-status")).not.toHaveClass(/text-red-700/);
    });
  } finally {
    await removeCleanupRuns(runs);
  }

  await test.step("a member doesn't see the scheduled jobs", async () => {
    const link = await inviteLink(owner, slugA, `cleanup-member${id}@example.com`);
    const member = await signUpAndConfirm(browser, baseURL!, "Max Member", `cleanup-member${id}@example.com`, {
      canCreateCompany: false,
    });
    await acceptInvite(member, link, slugA);
    await member.goto(`/w/${slugA}/settings`);
    await shows(member, "text=Only owners and admins can change these settings.");
    await hidden(member, "text=Scheduled jobs");
    await hidden(member, '[data-testid="daily-cleanup-status"]');
  });

  await test.step("another company's owner can't open this company's Settings", async () => {
    const other = await signUpAndConfirm(browser, baseURL!, "Oscar Other", `cleanup-other${id}@example.com`);
    await createOrg(other, "Other Cleanup Co", slugB);
    expect((await other.goto(`/w/${slugA}/settings`))?.status()).toBe(404);
    await other.goto(`/w/${slugB}/settings`);
    await expect(other.getByTestId("daily-cleanup-status")).toBeVisible();
  });
});
