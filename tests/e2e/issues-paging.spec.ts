import { expect, test } from "@playwright/test";
import pg from "pg";
import { createOrg, signUpAndConfirm, stamp, TEST_DB } from "./helpers";

/**
 * Adds fictional issues to a company, in the local test database only:
 * 60 open ones from the last minute ("Paging test 01" newest to "60"), one
 * open from 8 days ago, and one from 10 days ago that was resolved just now.
 */
async function seedIssues(slug: string) {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    const { rows } = await client.query("select id from public.organizations where slug = $1", [slug]);
    const org = rows[0].id as string;
    await client.query(
      `insert into public.issues (organization_id, customer_name, channel, subject, message, urgency, status, received_at)
       select $1, 'Test Person', 'email', 'Paging test ' || lpad(n::text, 2, '0'), 'Made-up test issue.', 'low', 'open',
              now() - make_interval(secs => n)
       from generate_series(1, 60) as n`,
      [org],
    );
    await client.query(
      `insert into public.issues (organization_id, customer_name, channel, subject, message, urgency, status, received_at)
       values ($1, 'Test Person', 'email', 'Old open one', 'Made-up test issue.', 'low', 'open', now() - interval '8 days'),
              ($1, 'Test Person', 'email', 'Old resolved one', 'Made-up test issue.', 'low', 'open', now() - interval '10 days')`,
      [org],
    );
    await client.query(
      "update public.issues set status = 'resolved', resolved_at = now() where organization_id = $1 and subject = 'Old resolved one'",
      [org],
    );
  } finally {
    await client.end();
  }
}

// Issues list pages (50 per page) and the "This week" filter the workspace
// home's card links to. Another company sees none of these issues.

test("issues list: pages keep the filters, and This week matches the home card", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `page-${id}`;
  const slugB = `page-other-${id}`;
  const W = `/w/${slugA}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `page${id}@example.com`);
  await createOrg(p, "Paging Co", slugA);
  await seedIssues(slugA);
  const rows = p.getByTestId("issue-row");
  const info = p.getByTestId("issues-page-info");
  const next = p.getByRole("link", { name: "Next" });
  const previous = p.getByRole("link", { name: "Previous" });

  await test.step("open issues come 50 to a page", async () => {
    await p.goto(`${W}/issues`);
    await expect(rows).toHaveCount(50);
    await expect(info).toHaveText("Page 1 · issues 1 to 50");
    await expect(rows.first()).toContainText("Paging test 01");
    await expect(previous).toHaveCount(0);
    await next.click();
    await p.waitForURL(/page=2/);
    await expect(rows).toHaveCount(11);
    await expect(info).toHaveText("Page 2 · issues 51 to 61");
    await expect(rows.last()).toContainText("Old open one");
    await expect(next).toHaveCount(0);
    await previous.click();
    await expect(rows).toHaveCount(50);
    await expect(rows.first()).toContainText("Paging test 01");
  });

  await test.step("the search stays on when changing page", async () => {
    await p.goto(`${W}/issues?q=Paging`);
    await next.click();
    await p.waitForURL(/page=2/);
    expect(new URL(p.url()).searchParams.get("q")).toBe("Paging");
    await expect(rows).toHaveCount(10);
    await expect(rows.last()).toContainText("Paging test 60");
  });

  await test.step("deadline sorting is paged too", async () => {
    await p.goto(`${W}/issues?sort=attention`);
    await expect(rows).toHaveCount(50);
    await next.click();
    await expect(rows).toHaveCount(11);
    expect(new URL(p.url()).searchParams.get("sort")).toBe("attention");
  });

  await test.step("the home card's This week lists what it counted", async () => {
    await p.goto(W);
    await expect(p.getByTestId("week-opened")).toHaveText("60");
    await expect(p.getByTestId("week-resolved")).toHaveText("1");
    await p.getByTestId("card-week").click();
    await p.waitForURL(/week=1/);
    await expect(p.locator("select[name=week]")).toHaveValue("1");
    await expect(rows).toHaveCount(50);
    await next.click();
    // 60 opened this week, plus the old one resolved this week. Not the old open one.
    await expect(rows).toHaveCount(11);
    await expect(rows.last()).toContainText("Old resolved one");
    await expect(p.getByText("Old open one")).toHaveCount(0);
    // A search and This week together: both must match.
    await p.goto(`${W}/issues?status=all&week=1&q=Old`);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Old resolved one");
  });

  await test.step("odd page numbers don't break the list", async () => {
    await p.goto(`${W}/issues?page=abc`);
    await expect(rows).toHaveCount(50);
    await expect(info).toHaveText("Page 1 · issues 1 to 50");
    await p.goto(`${W}/issues?page=999`);
    await expect(p.getByTestId("issues-page-empty")).toBeVisible();
    await p.getByRole("link", { name: "Go to the first page" }).click();
    await expect(rows).toHaveCount(50);
  });

  await test.step("another company sees none of these issues", async () => {
    const other = await signUpAndConfirm(browser, baseURL!, "Bea Other", `page-other${id}@example.com`);
    await createOrg(other, "Other Co", slugB);
    for (const query of ["", "?page=2", "?status=all&week=1"]) {
      await other.goto(`/w/${slugB}/issues${query}`);
      await expect(other.getByTestId("issue-row")).toHaveCount(0);
    }
    const response = await other.goto(`${W}/issues?page=2`);
    expect(response?.status()).toBe(404);
  });
});
