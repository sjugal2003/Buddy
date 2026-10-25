import { expect, test } from "@playwright/test";
import pg from "pg";
import { createOrg, signUpAndConfirm, stamp } from "./helpers";

const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Adds fictional issues with fixed ages to a company, in the local test
 * database only: one answered in 30 minutes and resolved, one never answered
 * (missed), and one from 40 days ago. Returns the company's "today" minus
 * 60 and 31 days, for a custom range that holds only the old one.
 */
async function seedIssues(slug: string) {
  const client = new pg.Client({ connectionString: DB });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select id, to_char((now() at time zone timezone)::date - 60, 'YYYY-MM-DD') as old_from,
              to_char((now() at time zone timezone)::date - 31, 'YYYY-MM-DD') as old_to
       from public.organizations where slug = $1`,
      [slug],
    );
    const org = rows[0];
    await client.query(
      `insert into public.issues (id, organization_id, customer_name, channel, subject, message, urgency, status, received_at, first_response_at)
       values
         ('${crypto.randomUUID()}', $1, 'Test Person', 'email', 'Answered quickly', 'Test', 'critical', 'resolved',
          now() - interval '2 days', now() - interval '2 days' + interval '30 minutes'),
         ('${crypto.randomUUID()}', $1, 'Test Person', 'live_chat', 'Never answered', 'Test', 'low', 'open',
          now() - interval '3 days', null),
         ('${crypto.randomUUID()}', $1, 'Test Person', 'email', 'Long ago', 'Test', 'medium', 'open',
          now() - interval '40 days', null)`,
      [org.id],
    );
    // Resolving stamps the current time; set when it really happened.
    await client.query(
      `update public.issues set resolved_at = received_at + interval '2 hours'
       where organization_id = $1 and subject = 'Answered quickly'`,
      [org.id],
    );
    return { oldFrom: org.old_from as string, oldTo: org.old_to as string };
  } finally {
    await client.end();
  }
}

// What the Reports page counts (rules in supabase/tests/security_test.sql):
// company figures for a date range, visible to its members only.

test("reports: company figures for a chosen range, private to the company", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `rep-${id}`;
  const slugB = `rep-other-${id}`;
  const W = `/w/${slugA}`;
  const A = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `rep${id}@example.com`);
  await createOrg(A, "Report Co", slugA);

  await test.step("a new company sees an empty report", async () => {
    await A.getByRole("link", { name: "Reports" }).click();
    await A.waitForURL(`**${W}/reports`);
    await expect(A.getByTestId("report-range")).toContainText("Last 30 days:");
    await expect(A.getByTestId("report-empty")).toContainText("Nothing happened in this period.");
  });

  const { oldFrom, oldTo } = await seedIssues(slugA);

  await test.step("the last 30 days count the recent issues only", async () => {
    await A.goto(`${W}/reports`);
    await expect(A.getByTestId("report-received")).toContainText("2");
    await expect(A.getByTestId("report-received")).toContainText("1 of them still open");
    await expect(A.getByTestId("report-resolved")).toContainText("1");
    await expect(A.getByTestId("report-response-median")).toContainText("30 min");
    await expect(A.getByTestId("report-target-share")).toContainText("50%");
    await expect(A.getByTestId("report-target-share")).toContainText("1 on time, 0 late, 1 missed");
    await expect(A.getByTestId("report-resolution")).toContainText("Median 2 h");
    await expect(A.getByTestId("report-teams")).toContainText("No team");
    await expect(A.getByTestId("report-urgency")).toContainText("Critical");
    await expect(A.getByTestId("report-channels")).toContainText("Live chat");
    await expect(A.getByTestId("report-escalations-empty")).toBeVisible();
  });

  await test.step("the last 7 days and a custom range", async () => {
    await A.getByRole("link", { name: "Last 7 days" }).click();
    await A.waitForURL(/range=7d/);
    await expect(A.getByTestId("report-range")).toContainText("Last 7 days:");
    await expect(A.getByTestId("report-received")).toContainText("2");

    await A.fill("input[name=from]", oldFrom);
    await A.fill("input[name=to]", oldTo);
    await A.click('button:has-text("Show custom range")');
    await A.waitForURL(/range=custom/);
    await expect(A.getByTestId("report-range")).toContainText("Custom range:");
    await expect(A.getByTestId("report-received")).toContainText("1");
    await expect(A.getByTestId("report-received")).toContainText("1 of them still open");
  });

  await test.step("an unusable range says so and shows the last 30 days", async () => {
    await A.goto(`${W}/reports?range=custom&from=2025-02-01&to=2025-01-01`);
    await expect(A.getByTestId("report-range-error")).toContainText("Choose a start date on or before the end date.");
    await expect(A.getByTestId("report-range")).toContainText("Last 30 days:");
  });

  await test.step("another company cannot see it, and its own report is empty", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bea Owner", `rep-other${id}@example.com`);
    await createOrg(B, "Other Co", slugB);
    expect((await B.goto(`${W}/reports`))?.status()).toBe(404);
    await B.goto(`/w/${slugB}/reports`);
    await expect(B.getByTestId("report-empty")).toBeVisible();
  });
});
