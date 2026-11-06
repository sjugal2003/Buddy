import { expect, test } from "@playwright/test";
import { createOrg, hidden, shows, signUpAndConfirm, stamp } from "./helpers";

test("issues: add, update, filter, and keep other companies out", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `acme-${id}`;
  const slugB = `other-${id}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `owner${id}@example.com`);
  await createOrg(p, "Acme Test", slugA);

  await test.step("a new workspace has no open issues and explains how to add one", async () => {
    await shows(p, "text=No open issues");
    await p.click("nav[aria-label=Workspace] >> text=Issues");
    await p.waitForURL(`**/w/${slugA}/issues`);
    await shows(p, "text=No open issues yet");
  });

  await test.step("empty issue form shows field errors and saves nothing", async () => {
    await p.goto(`/w/${slugA}/issues/new`);
    await p.click("main button[type=submit]");
    await shows(p, "text=Enter the customer's name.");
    await shows(p, "text=Enter what the customer said.");
  });

  const issueUrl = await test.step("saving an issue opens it with a confirmation and history", async () => {
    await p.fill("input[name=customerName]", "Priya Shah");
    await p.selectOption("select[name=channel]", "live_chat");
    await p.fill("input[name=subject]", "Router keeps dropping");
    await p.fill("textarea[name=message]", "My internet drops every evening around 8pm.");
    await p.selectOption("select[name=urgency]", "high");
    await p.selectOption("select[name=sentiment]", "negative");
    await p.selectOption("select[name=intent]", "complaint");
    await p.click("main button[type=submit]");
    await p.waitForURL(/\/issues\/[0-9a-f-]{36}\?created=1/);
    await shows(p, "text=Issue saved.");
    await shows(p, "text=Issue created as New");
    return p.url().split("?")[0];
  });

  await test.step("status and assignment are saved, kept in the form and shown in history", async () => {
    await p.selectOption("select[name=status]", "in_progress");
    // Members are picked from a list (assign-to-person.spec.ts covers more).
    await p.selectOption("select[name=assigneeId]", { label: "Alice Owner" });
    await p.click('button:has-text("Save changes")');
    await shows(p, "text=Changes saved.");
    await expect(p.locator("select[name=status]")).toHaveValue("in_progress");
    await expect(p.locator("select[name=assigneeId] option:checked")).toHaveText("Alice Owner");
    await shows(p, "text=Status changed from New to In progress");
    await shows(p, "text=Assigned to Alice Owner");
    await p.reload();
    await expect(p.locator("select[name=status]")).toHaveValue("in_progress");
  });

  await test.step("six quick saves in a row all finish", async () => {
    // A page-level loading screen once made about one save in six hang in production.
    for (const status of ["open", "waiting_on_customer", "escalated", "open", "waiting_on_customer", "in_progress"]) {
      await p.selectOption("select[name=status]", status);
      await p.click('button:has-text("Save changes")');
      await expect(p.locator('button:has-text("Save changes")')).toBeEnabled();
      await expect(p.locator("select[name=status]")).toHaveValue(status);
    }
  });

  await test.step("the inbox lists, filters and searches issues", async () => {
    await p.goto(`/w/${slugA}/issues`);
    await shows(p, "text=Router keeps dropping");
    await p.goto(`/w/${slugA}/issues?status=resolved`);
    await shows(p, "text=No issues match these filters.");
    await p.goto(`/w/${slugA}/issues?q=priya`);
    await shows(p, "text=Router keeps dropping");
    await p.goto(`/w/${slugA}/issues?q=${encodeURIComponent("%,status.eq.new)")}`);
    await shows(p, "text=No issues match these filters.");
    await p.goto(`/w/${slugA}`);
    await shows(p, "text=1 open issue");
  });

  await test.step("resolved issues leave the open list", async () => {
    await p.goto(issueUrl);
    await p.selectOption("select[name=status]", "resolved");
    await p.click('button:has-text("Save changes")');
    await shows(p, "text=Resolved (was In progress)");
    await p.goto(`/w/${slugA}/issues`);
    await shows(p, "text=No open issues yet");
    await hidden(p, "text=Router keeps dropping");
  });

  await test.step("another company cannot open or list the issue", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `other${id}@example.com`);
    await createOrg(B, "Other Co", slugB);
    expect((await B.goto(issueUrl))?.status()).toBe(404);
    await B.goto(`/w/${slugB}/issues/${issueUrl.split("/").pop()}`);
    await shows(B, "text=Page not found");
    await hidden(B, "text=Router keeps dropping");
    await B.goto(`/w/${slugB}/issues?status=all`);
    await shows(B, "text=No issues match these filters.");
    await hidden(B, "text=Router keeps dropping");
    await B.goto(`/w/${slugB}/issues/not-a-uuid`);
    await shows(B, "text=Page not found");
  });

  await test.step("signed-out visitors are sent to sign in", async () => {
    const anon = await browser.newPage({ baseURL });
    await anon.goto(issueUrl);
    expect(anon.url()).toContain("/login");
  });
});
