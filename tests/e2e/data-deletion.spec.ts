import { expect, test, type Page } from "@playwright/test";
import { acceptInvite, createOrg, hidden, shows, signUpAndConfirm, stamp } from "./helpers";

// Phase 7 stage 37: owners delete an issue or a customer's data, choose how
// long resolved issues are kept, and see a log without customer details.
// Rules are also checked in supabase/tests/security_test.sql.

async function addIssue(page: Page, slug: string, subject: string, email: string) {
  await page.goto(`/w/${slug}/issues/new`);
  await page.fill("input[name=customerName]", "Gina Gone");
  await page.fill("input[name=customerEmail]", email);
  await page.fill("input[name=subject]", subject);
  await page.fill("textarea[name=message]", "Please delete everything you hold about me.");
  await page.click("main button[type=submit]");
  await page.waitForURL(/\/issues\/[0-9a-f-]{36}\?created=1/);
  return page.url().split("?")[0];
}

test("owners delete an issue or a customer's data; admins can't; other companies keep theirs", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `delete-a-${id}`;
  const slugB = `delete-b-${id}`;
  const customer = `gina${id}@example.com`;

  const owner = await signUpAndConfirm(browser, baseURL!, "Olive Owner", `del-owner${id}@example.com`);
  await createOrg(owner, "Delete Co", slugA);
  const other = await signUpAndConfirm(browser, baseURL!, "Bob Other", `del-other${id}@example.com`);
  await createOrg(other, "Other Co", slugB);

  const issueUrl = await addIssue(owner, slugA, "Single issue to delete", `single${id}@example.com`);
  await addIssue(owner, slugA, "Customer issue one", customer);
  await addIssue(owner, slugA, "Customer issue two", customer);
  const otherIssueUrl = await addIssue(other, slugB, "Other company's issue", customer);

  await test.step("an admin sees no delete buttons", async () => {
    await owner.goto(`/w/${slugA}`);
    await owner.fill("input[name=email]", `del-admin${id}@example.com`);
    await owner.locator("form:has(input[name=email]) select[name=role]").selectOption("admin");
    await owner.click('button:has-text("Create invite link")');
    const link = await owner.locator('input[aria-label="Invitation link"]').inputValue();
    const admin = await signUpAndConfirm(browser, baseURL!, "Ada Admin", `del-admin${id}@example.com`, { canCreateCompany: false });
    await acceptInvite(admin, link, slugA);
    await admin.goto(issueUrl);
    await shows(admin, "text=Single issue to delete");
    await hidden(admin, "text=Delete this issue for good");
    await admin.goto(`/w/${slugA}/settings`);
    await shows(admin, "text=Only the owner can delete data or change how long it is kept.");
    await hidden(admin, "text=Delete this customer's issues");
  });

  await test.step("the owner must type the reference, then the issue is gone", async () => {
    await owner.goto(issueUrl);
    const label = await owner.getByText(/^Type ISS-[0-9A-F]{8} to confirm$/).innerText();
    const reference = label.match(/ISS-[0-9A-F]{8}/)?.[0];
    expect(reference).toBeTruthy();
    await owner.fill("input[name=confirm]", "ISS-WRONG");
    await owner.click('button:has-text("Delete this issue for good")');
    await shows(owner, `text=Type ${reference} to confirm.`);
    await owner.fill("input[name=confirm]", reference!.toLowerCase());
    await owner.click('button:has-text("Delete this issue for good")');
    await owner.waitForURL(`**/w/${slugA}/issues?deleted=*`);
    await shows(owner, `text=Issue ${reference} was deleted.`);
    await hidden(owner, "text=Single issue to delete");
    const gone = await owner.goto(issueUrl);
    expect(gone?.status()).toBe(404);
  });

  await test.step("deleting a customer's data needs the box ticked, then removes all their issues here", async () => {
    await owner.goto(`/w/${slugA}/settings`);
    await owner.getByRole("textbox", { name: /Customer's email/ }).fill(customer.toUpperCase());
    await owner.click('button:has-text("Delete this customer\'s issues")');
    await shows(owner, "text=Tick the box to confirm.");
    await owner.check("input[name=confirm][type=checkbox]");
    await owner.click('button:has-text("Delete this customer\'s issues")');
    await shows(owner, "text=Deleted 2 issues from that email.");
    await owner.goto(`/w/${slugA}/issues?status=all`);
    await hidden(owner, "text=Customer issue one");
    await hidden(owner, "text=Customer issue two");
  });

  await test.step("the log lists both deletions without the customer's details", async () => {
    await owner.goto(`/w/${slugA}/settings`);
    const log = owner.getByTestId("deletion-log");
    await expect(log).toContainText("Olive Owner deleted a customer's data (2 issues)");
    await expect(log).toContainText("Olive Owner deleted issue ISS-");
    await expect(log).not.toContainText(customer);
    await expect(log).not.toContainText("Gina");
  });

  await test.step("another company's issue from the same email is untouched", async () => {
    await other.goto(otherIssueUrl);
    await shows(other, "text=Other company's issue");
    await other.goto(`/w/${slugB}/settings`);
    await shows(other, "text=Nothing has been deleted yet.");
  });

  await test.step("the owner chooses how long resolved issues are kept", async () => {
    await owner.goto(`/w/${slugA}/settings`);
    await expect(owner.getByTestId("retention-status")).toHaveText("Kept until someone deletes them");
    await owner.selectOption("select[name=retentionDays]", "90");
    await owner.click('form:has(select[name=retentionDays]) button:has-text("Save")');
    await shows(owner, "text=Saved. The daily clean-up (03:30 UTC) deletes resolved issues older than this.");
    await expect(owner.getByTestId("retention-status")).toHaveText("Deleted 90 days after they are resolved");
  });
});
