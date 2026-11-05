import { expect, test } from "@playwright/test";
import pg from "pg";
import { createOrg, signUpAndConfirm, stamp, TEST_DB } from "./helpers";

// Repeated problems (improvement D, step 2), with made-up issues in the local
// test database only. Counting and notifications are checked in
// supabase/tests/security_test.sql.

async function seed(slug: string, references: string[]) {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    const { rows } = await client.query("select id from public.organizations where slug = $1", [slug]);
    const ids: Record<string, string> = {};
    for (const [n, reference] of references.entries()) {
      const { rows: added } = await client.query(
        `insert into public.issues (organization_id, reference, customer_name, channel, subject, message, received_at)
         values ($1, $2, 'Test Person', 'email', 'App crashes on checkout', 'Made-up test issue.',
                 now() - make_interval(mins => $3)) returning id`,
        [rows[0].id, reference, 10 - n],
      );
      ids[reference] = added[0].id;
    }
    return ids;
  } finally {
    await client.end();
  }
}

test("Repeated problems: 3 reports show on Reports and Overview and notify; other companies see nothing", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `repeat-${id}`;
  const W = `/w/${slug}`;
  const main = `MAIN-${id}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `repeat${id}@example.com`);
  await createOrg(p, "Repeat Co", slug);
  const ids = await seed(slug, [main, `RA-${id}`, `RB-${id}`]);

  await test.step("link two reports to the main issue", async () => {
    for (const ref of [`RA-${id}`, `RB-${id}`]) {
      await p.goto(`${W}/issues/${ids[ref]}`);
      await p.getByRole("button", { name: `Same problem as ${main}` }).click();
      await expect(p.getByTestId("duplicate-of")).toContainText(`Same problem as ${main}`);
    }
  });

  await test.step("the Reports page lists it", async () => {
    await p.goto(`${W}/reports`);
    const table = p.getByTestId("report-repeated");
    await expect(table.getByRole("row")).toHaveCount(2);
    const row = table.getByRole("row").filter({ hasText: main });
    await expect(row).toContainText("App crashes on checkout");
    await expect(row.getByRole("cell").nth(2)).toHaveText("3");
    await expect(row.getByRole("cell").nth(3)).toHaveText("3");
  });

  await test.step("the Overview shows it, and a notification arrived", async () => {
    await p.goto(W);
    await expect(p.getByTestId("most-reported")).toContainText("App crashes on checkout");
    await expect(p.getByTestId("most-reported")).toContainText("Reported 3 times");
    await p.goto(`${W}/notifications`);
    await expect(p.getByTestId("notification-list")).toContainText(`${main} has been reported 3 times.`);
  });

  await test.step("another company sees none of it", async () => {
    const b = await signUpAndConfirm(browser, baseURL!, "Bob Other", `repeatb${id}@example.com`);
    await createOrg(b, "Other Co", `repeat-b-${id}`);
    await seed(`repeat-b-${id}`, [`OTHER-${id}`]);
    await b.goto(`/w/repeat-b-${id}/reports`);
    await expect(b.getByTestId("report-repeated-empty")).toBeVisible();
    await b.goto(`/w/repeat-b-${id}`);
    await expect(b.getByTestId("most-reported")).toHaveCount(0);
    await b.goto(`/w/repeat-b-${id}/notifications`);
    await expect(b.getByTestId("notifications-empty")).toBeVisible();
    await b.context().close();
  });
});

// Merging before the database change is applied must not break the pages.
test("Reports still load with the report function from before repeated problems", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `repeat-missing-${id}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `repeatmissing${id}@example.com`);
  await createOrg(p, "Missing Co", slug);
  await seed(slug, [`ONE-${id}`]);
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    // Put the earlier report function back in place of the new one.
    await client.query("alter function public.issue_report(uuid, date, date) rename to issue_report_new");
    await client.query("alter function private.issue_report_base(uuid, date, date) set schema public");
    await client.query("alter function public.issue_report_base(uuid, date, date) rename to issue_report");
    await client.query("grant execute on function public.issue_report(uuid, date, date) to authenticated");
    await client.query("notify pgrst, 'reload schema'");
    await expect(async () => {
      await p.goto(`/w/${slug}/reports`);
      await expect(p.getByTestId("report-repeated-unavailable")).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await expect(p.getByTestId("report-download")).toBeVisible();
    const download = await p.request.get(`/w/${slug}/reports/download?range=30d`);
    expect(download.status()).toBe(200);
  } finally {
    await client.query("alter function public.issue_report(uuid, date, date) rename to issue_report_base").catch(() => {});
    await client.query("revoke all on function public.issue_report_base(uuid, date, date) from authenticated").catch(() => {});
    await client.query("alter function public.issue_report_base(uuid, date, date) set schema private").catch(() => {});
    await client.query("alter function public.issue_report_new(uuid, date, date) rename to issue_report").catch(() => {});
    await client.query("notify pgrst, 'reload schema'");
    await client.end();
  }
});
