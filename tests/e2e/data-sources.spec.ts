import { expect, test } from "@playwright/test";
import pg from "pg";
import { acceptInvite, createOrg, inviteLink, signUpAndConfirm, stamp } from "./helpers";

// Customer email on typed-in issues, and the Data sources page with its
// import history. CSV upload arrives in the next stage, so the import here is
// run straight in the local test database, signed in as the owner, through
// the same functions the upload will use.

async function importAsUser(email: string, slug: string) {
  const client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
  await client.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      "select u.id as uid, o.id as org from auth.users u, public.organizations o where u.email = $1 and o.slug = $2",
      [email, slug],
    );
    const { uid, org } = rows[0];
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    await client.query("set local role authenticated");
    const run = await client.query("select public.start_import($1, 'csv', 'october-export.csv') as id", [org]);
    const rowsToImport = [
      { row: 2, record_id: "T-100", customer_name: "Sam Sender", customer_email: "Sam@Example.com", channel: "email", subject: "Refund not received", message: "Still waiting for my refund.", received_at: "2026-10-01T09:00:00Z" },
      { row: 3, record_id: "T-100", customer_name: "Sam Sender", channel: "email", subject: "Refund not received", message: "Still waiting for my refund.", received_at: "2026-10-01T09:00:00Z" },
      { row: 4, customer_name: "", channel: "email", subject: "No name", message: "Hello", received_at: "2026-10-01T09:00:00Z" },
    ];
    await client.query("select public.import_issues($1, $2::jsonb)", [run.rows[0].id, JSON.stringify(rowsToImport)]);
    await client.query("select public.finish_import($1)", [run.rows[0].id]);
    await client.query("commit");
  } finally {
    await client.end();
  }
}

test("data sources: customer email, honest source list and import history per company", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `src-${id}`;
  const slugB = `src-other-${id}`;
  const W = `/w/${slugA}`;
  const ownerEmail = `src${id}@example.com`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", ownerEmail);
  await createOrg(p, "Source Co", slugA);

  await test.step("a typed-in issue keeps the customer's email", async () => {
    await p.goto(`${W}/issues/new`);
    await p.fill("input[name=customerName]", "Dana Customer");
    await p.fill("input[name=customerEmail]", "not-an-email");
    await p.fill("input[name=subject]", "Wrong bill");
    await p.fill("textarea[name=message]", "I was charged twice.");
    // The browser's own check stops an invalid address before it is sent.
    await p.click("main button[type=submit]");
    await expect(p).toHaveURL(/issues\/new/);
    await p.fill("input[name=customerEmail]", " Dana@Example.COM ");
    await p.click("main button[type=submit]");
    await p.waitForURL(/created=1/);
    await expect(p.getByTestId("customer-email")).toHaveText("dana@example.com");
    await expect(p.getByTestId("issue-origin")).not.toContainText("Imported from");
  });

  await test.step("the Data sources tab says what is and is not available", async () => {
    await p.goto(W);
    await p.getByRole("link", { name: "Data sources" }).click();
    await p.waitForURL(`**${W}/data-sources`);
    const sources = p.getByTestId("source-list");
    await expect(sources).toContainText("Available: owners and admins import a file below.");
    await expect(sources).toContainText("Not connected");
    await expect(p.getByTestId("imports-empty")).toHaveText("No imports yet.");
  });

  await test.step("an import shows in the history with its counts", async () => {
    await importAsUser(ownerEmail, slugA);
    await p.reload();
    const row = p.getByTestId("import-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("october-export.csv");
    await expect(row).toContainText("Alice Owner");
    await expect(row).toContainText("Finished");
    await expect(row.locator("td").nth(4)).toHaveText("3");
    await expect(row.locator("td").nth(5)).toHaveText("1");
    await expect(row.locator("td").nth(6)).toHaveText("1");
    await expect(row.locator("td").nth(7)).toHaveText("1");
    await row.getByText("Why rows were rejected").click();
    await expect(row).toContainText("Row 4: The customer name is empty.");
  });

  await test.step("the imported issue says where it came from", async () => {
    await p.goto(`${W}/issues?q=Refund`);
    await p.getByTestId("issue-row").getByRole("link").click();
    await expect(p.getByTestId("customer-email")).toHaveText("sam@example.com");
    await expect(p.getByTestId("issue-origin")).toContainText("Spreadsheet (CSV) (ID T-100)");
  });

  await test.step("a member sees the history too", async () => {
    const emailM = `srcmember${id}@example.com`;
    const link = await inviteLink(p, slugA, emailM);
    const M = await signUpAndConfirm(browser, baseURL!, "Mia Member", emailM);
    await acceptInvite(M, link, slugA);
    await M.goto(`${W}/data-sources`);
    await expect(M.getByTestId("import-row")).toHaveCount(1);
    await expect(M.getByTestId("import-not-allowed")).toBeVisible();
    await expect(M.getByTestId("csv-file")).toHaveCount(0);
  });

  await test.step("another company sees none of it", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `srcother${id}@example.com`);
    await createOrg(B, "Other Source Co", slugB);
    await B.goto(`/w/${slugB}/data-sources`);
    await expect(B.getByTestId("imports-empty")).toBeVisible();
    await expect(B.locator("main")).not.toContainText("october-export.csv");
    expect((await B.goto(`${W}/data-sources`))?.status()).toBe(404);
  });
});
