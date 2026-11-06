import { expect, test } from "@playwright/test";
import pg from "pg";
import { acceptInvite, createOrg, inviteLink, shows, signUpAndConfirm, stamp, TEST_DB } from "./helpers";

// Assigning issues to a person (improvement after D, step 2), with made-up
// issues in the local test database only. Who may assign whom, the name and
// history, leaving the company, the limit and other companies are checked in
// supabase/tests/security_test.sql. Here: the picker, the member's
// notification, the "Assigned to me" card and filter, and another company.

async function createIssue(page: import("@playwright/test").Page, W: string, subject: string) {
  await page.goto(`${W}/issues/new`);
  await page.fill("input[name=customerName]", "Pat Example");
  await page.fill("input[name=subject]", subject);
  await page.fill("textarea[name=message]", "Secret customer words.");
  await page.click("main button[type=submit]");
  await page.waitForURL(/created=1/);
  return new URL(page.url()).pathname;
}

test("assigning: owner gives an issue to a member, who is told and finds it under Assigned to me", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `assign-${id}`;
  const otherSlug = `assign-other-${id}`;
  const W = `/w/${slug}`;
  const memberEmail = `assign-member${id}@example.com`;

  const owner = await signUpAndConfirm(browser, baseURL!, "Olive Owner", `assign-owner${id}@example.com`);
  await createOrg(owner, "Assign Co", slug);
  const link = await inviteLink(owner, slug, memberEmail);
  const member = await signUpAndConfirm(browser, baseURL!, "Mo Member", memberEmail, { canCreateCompany: false });
  await acceptInvite(member, link, slug);

  const issueUrl = await createIssue(owner, W, "Charged twice");
  const header = await owner.locator("main h1").locator("xpath=preceding-sibling::p[1]").textContent();
  const reference = header!.split(" · ")[0].trim();

  await test.step("owner picks the member from the list", async () => {
    const select = owner.getByTestId("assignee-select");
    await expect(select.locator("option")).toHaveText(["Nobody", "Olive Owner", "Mo Member"]);
    await select.selectOption({ label: "Mo Member" });
    await owner.click('button:has-text("Save changes")');
    await shows(owner, "text=Changes saved.");
    await expect(owner.getByTestId("assignee-select").locator("option:checked")).toHaveText("Mo Member");
    await expect(owner.getByText("Assigned to Mo Member").first()).toBeVisible();
  });

  await test.step("the member is notified, with only the issue's reference", async () => {
    await member.goto(W);
    await expect(member.getByTestId("notification-count")).toHaveText("1");
    await member.goto(`${W}/notifications`);
    const item = member.getByTestId("notification-item");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(`${reference} was assigned to you.`);
    await expect(item).toContainText("Assigned to you");
    await expect(member.getByTestId("notification-list")).not.toContainText("Secret customer words.");
    await expect(member.getByTestId("notification-list")).not.toContainText("Pat Example");
  });

  await test.step("the member's Overview card and filter show the issue", async () => {
    await member.goto(W);
    await expect(member.getByTestId("card-assigned")).toContainText("1");
    await member.getByTestId("card-assigned").click();
    await member.waitForURL(/mine=1/);
    await expect(member.getByTestId("issue-row")).toHaveCount(1);
    await expect(member.getByTestId("issue-row")).toContainText("Charged twice");
    await expect(member.getByTestId("issue-row")).toContainText("Mo Member");
    await expect(member.getByLabel("Assigned")).toHaveValue("1");
  });

  await test.step("the owner has nothing assigned and was not notified", async () => {
    await owner.goto(W);
    await expect(owner.getByTestId("card-assigned")).toContainText("0");
    await owner.goto(`${W}/issues?mine=1`);
    await shows(owner, "text=No issues match these filters.");
    await owner.goto(`${W}/notifications`);
    await expect(owner.getByTestId("notification-item").filter({ hasText: "assigned to you" })).toHaveCount(0);
  });

  await test.step("taking an issue yourself sends no notification", async () => {
    await owner.goto(issueUrl);
    await owner.getByTestId("assignee-select").selectOption({ label: "Olive Owner" });
    await owner.click('button:has-text("Save changes")');
    await shows(owner, "text=Changes saved.");
    await owner.goto(`${W}/notifications`);
    await expect(owner.getByTestId("notification-item").filter({ hasText: "assigned to you" })).toHaveCount(0);
    await owner.goto(W);
    await expect(owner.getByTestId("card-assigned")).toContainText("1");
  });

  await test.step("unassigning puts it back to Nobody", async () => {
    await owner.goto(issueUrl);
    await owner.getByTestId("assignee-select").selectOption({ label: "Nobody" });
    await owner.click('button:has-text("Save changes")');
    await shows(owner, "text=Changes saved.");
    await expect(owner.getByTestId("assignee-select").locator("option:checked")).toHaveText("Nobody");
  });

  await test.step("another company sees none of it", async () => {
    const other = await signUpAndConfirm(browser, baseURL!, "Bea Other", `assign-other${id}@example.com`);
    await createOrg(other, "Other Co", otherSlug);
    await other.goto(`/w/${otherSlug}`);
    await expect(other.getByTestId("card-assigned")).toContainText("0");
    await other.goto(`/w/${otherSlug}/notifications`);
    await shows(other, '[data-testid="notifications-empty"]');
    const response = await other.goto(issueUrl);
    expect(response?.status()).toBe(404);
  });
});

// Merging before the database change is applied must not break the pages:
// the older list of names stays, and the card and filter are left out.
test("Issue pages still work without the assigning database change", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `assign-missing-${id}`;
  const W = `/w/${slug}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `assignmissing${id}@example.com`);
  await createOrg(p, "Missing Co", slug);
  const issueUrl = await createIssue(p, W, "Payment failed");
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    // As before the migration: no column and none of its triggers.
    for (const trigger of ["issue_set_assignee_name", "issues_assign_rate_limit", "issues_notify_assignee"]) {
      await client.query(`alter table public.issues disable trigger ${trigger}`);
    }
    await client.query("alter table public.issues rename column assignee_id to assignee_id_hidden");
    await client.query("notify pgrst, 'reload schema'");
    await expect(async () => {
      await p.goto(issueUrl);
      await expect(p.locator("select[name=assigneeName]")).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await expect(p.getByTestId("assignee-select")).toHaveCount(0);
    await p.locator("select[name=assigneeName]").selectOption({ label: "Alice Owner" });
    await p.click('button:has-text("Save changes")');
    await shows(p, "text=Changes saved.");
    await p.goto(`${W}/issues?mine=1`);
    await expect(p.getByTestId("issue-row")).toHaveCount(1);
    await expect(p.getByLabel("Assigned")).toHaveCount(0);
    await p.goto(W);
    await expect(p.getByRole("heading", { name: "Missing Co" })).toBeVisible();
    await expect(p.getByTestId("card-assigned")).toHaveCount(0);
  } finally {
    await client.query("alter table public.issues rename column assignee_id_hidden to assignee_id").catch(() => {});
    for (const trigger of ["issue_set_assignee_name", "issues_assign_rate_limit", "issues_notify_assignee"]) {
      await client.query(`alter table public.issues enable trigger ${trigger}`).catch(() => {});
    }
    await client.query("notify pgrst, 'reload schema'");
    await client.end();
  }
});
