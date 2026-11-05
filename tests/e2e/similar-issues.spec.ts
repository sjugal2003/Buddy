import { expect, test } from "@playwright/test";
import pg from "pg";
import { createOrg, signUpAndConfirm, stamp, TEST_DB } from "./helpers";

// Similar issues and "same problem" links (improvement D, step 1), with
// made-up issues in the local test database only. Who may see and link what
// is checked in supabase/tests/security_test.sql.

/** Adds made-up issues to a company and returns their IDs by reference. */
async function seed(slug: string, issues: { reference: string; subject: string; message: string }[]) {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    const { rows } = await client.query("select id from public.organizations where slug = $1", [slug]);
    const ids: Record<string, string> = {};
    for (const [n, issue] of issues.entries()) {
      const { rows: added } = await client.query(
        `insert into public.issues (organization_id, reference, customer_name, channel, subject, message, received_at)
         values ($1, $2, 'Test Person', 'email', $3, $4, now() - make_interval(mins => $5)) returning id`,
        [rows[0].id, issue.reference, issue.subject, issue.message, 10 - n],
      );
      ids[issue.reference] = added[0].id;
    }
    return ids;
  } finally {
    await client.end();
  }
}

test("Similar issues: look-alikes are shown, linked and unlinked; other companies see nothing", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `similar-${id}`;
  const W = `/w/${slug}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `similar${id}@example.com`);
  await createOrg(p, "Similar Co", slug);
  const ids = await seed(slug, [
    { reference: `PAY-1-${id}`, subject: "Payment failed but I was charged", message: "My card was charged but the order never went through." },
    { reference: `PAY-2-${id}`, subject: "Payment failed, charged twice", message: "Payment failed and I was charged, but there is no order." },
    { reference: `SRCH-${id}`, subject: "Search is very slow", message: "Looking for products takes ages." },
  ]);

  await test.step("two look-alike issues show each other, and the unrelated one doesn't", async () => {
    await p.goto(`${W}/issues/${ids[`PAY-2-${id}`]}`);
    const list = p.getByTestId("similar-issues");
    await expect(list.getByTestId("similar-issue")).toHaveCount(1);
    await expect(list).toContainText(`PAY-1-${id}`);
    await expect(list).not.toContainText(`SRCH-${id}`);
    await p.goto(`${W}/issues/${ids[`SRCH-${id}`]}`);
    await expect(p.getByTestId("similar-none")).toBeVisible();
  });

  await test.step("Same problem links them; Reported 2 times and the badge appear", async () => {
    await p.goto(`${W}/issues/${ids[`PAY-2-${id}`]}`);
    await p.getByRole("button", { name: `Same problem as PAY-1-${id}` }).click();
    await expect(p.getByTestId("duplicate-of")).toContainText(`Same problem as PAY-1-${id}`);
    await expect(p.getByTestId("similar-none")).toBeVisible();
    await expect(p.getByText(`Linked to PAY-1-${id} as the same problem`)).toBeVisible();
    // Linking changes nothing else.
    await expect(p.locator("select[name=status]")).toHaveValue("new");

    await p.getByTestId("duplicate-of").getByRole("link", { name: `PAY-1-${id}` }).click();
    await expect(p.getByTestId("linked-reports")).toContainText("Reported 2 times");
    await expect(p.getByTestId("linked-reports")).toContainText(`PAY-2-${id}`);

    await p.goto(`${W}/issues?status=all`);
    const row = p.getByTestId("issue-row").filter({ hasText: `PAY-1-${id}` });
    await expect(row.getByTestId("reports-badge")).toHaveText("+1 report");
    await expect(p.getByTestId("reports-badge")).toHaveCount(1);
  });

  await test.step("another company sees none of it", async () => {
    const b = await signUpAndConfirm(browser, baseURL!, "Bob Other", `similarb${id}@example.com`);
    await createOrg(b, "Other Co", `similar-b-${id}`);
    await b.goto(`${W}/issues/${ids[`PAY-1-${id}`]}`);
    await expect(b.getByTestId("linked-reports")).toHaveCount(0);
    await expect(b.getByText("Payment failed but I was charged")).toHaveCount(0);
    await b.goto(`/w/similar-b-${id}/issues?status=all`);
    await expect(b.getByTestId("reports-badge")).toHaveCount(0);
    await b.context().close();
  });

  await test.step("Unlink removes the link and the badge", async () => {
    await p.goto(`${W}/issues/${ids[`PAY-2-${id}`]}`);
    await p.getByTestId("duplicate-of").getByRole("button", { name: "Unlink" }).click();
    await expect(p.getByTestId("duplicate-of")).toHaveCount(0);
    await expect(p.getByTestId("similar-issues")).toContainText(`PAY-1-${id}`);
    await expect(p.getByText(`Unlinked from PAY-1-${id}`)).toBeVisible();
    await p.goto(`${W}/issues?status=all`);
    await expect(p.getByTestId("reports-badge")).toHaveCount(0);
  });
});

// Merging before the database change is applied must not break the pages:
// the card says similar issues come later, and everything else still works.
test("Issue pages still load without the similar-issues database change", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `similar-missing-${id}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `similarmissing${id}@example.com`);
  await createOrg(p, "Missing Co", slug);
  const ids = await seed(slug, [{ reference: `MISS-${id}`, subject: "Payment failed", message: "Made-up test issue." }]);
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    await client.query("alter table public.issues rename column duplicate_of to duplicate_of_hidden");
    await client.query("alter function public.similar_issues(uuid) rename to similar_issues_hidden");
    await client.query("notify pgrst, 'reload schema'");
    await expect(async () => {
      await p.goto(`/w/${slug}/issues/${ids[`MISS-${id}`]}`);
      await expect(p.getByTestId("similar-unavailable")).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await expect(p.getByRole("heading", { name: "Payment failed" })).toBeVisible();
    await expect(p.getByTestId("deadlines")).toBeVisible();
    await p.goto(`/w/${slug}/issues?status=all`);
    await expect(p.getByTestId("issue-row")).toHaveCount(1);
    await expect(p.getByTestId("reports-badge")).toHaveCount(0);
  } finally {
    await client.query("alter table public.issues rename column duplicate_of_hidden to duplicate_of").catch(() => {});
    await client.query("alter function public.similar_issues_hidden(uuid) rename to similar_issues").catch(() => {});
    await client.query("notify pgrst, 'reload schema'");
    await client.end();
  }
});
