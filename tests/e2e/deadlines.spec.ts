import { expect, test } from "@playwright/test";
import { createOrg, hidden, shows, signUpAndConfirm, stamp } from "./helpers";

// Deadlines come from the company's targets; the maths itself is unit tested
// in tests/unit/targets.test.ts. Here: the screens, the first response, the
// lifecycle history, and that another company stays out.

test("deadlines and resolution: targets, first response, waiting, resolve and reopen", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `due-${id}`;
  const slugB = `due-other-${id}`;
  const W = `/w/${slugA}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `due${id}@example.com`);
  await createOrg(p, "Due Co", slugA);

  await test.step("the owner sets resolution targets, and bad values are refused", async () => {
    await p.goto(`${W}/settings`);
    await expect(p.locator("input[name=resolutionCritical]")).toHaveValue("8");
    await p.fill("input[name=resolutionLow]", "3000");
    await p.click('button:has-text("Save settings")');
    await shows(p, "text=Use 2,160 hours (90 days) or fewer.");
    await p.fill("input[name=resolutionLow]", "200");
    await p.fill("input[name=resolutionCritical]", "6");
    await p.click('button:has-text("Save settings")');
    await shows(p, "text=Settings saved.");
    await p.reload();
    await expect(p.locator("input[name=resolutionCritical]")).toHaveValue("6");
    await p.fill("#new-category", "Billing");
    await p.click('button:has-text("Add category")');
    await shows(p, 'text=Category "Billing" added.');
  });

  const issueUrl = await test.step("a new critical issue shows both deadlines", async () => {
    await p.goto(`${W}/issues/new`);
    await p.fill("input[name=customerName]", "Sam Late");
    await p.fill("input[name=subject]", "Card charged, no order");
    await p.fill("textarea[name=message]", "I paid but got no confirmation.");
    await p.selectOption("select[name=urgency]", "critical");
    await p.click("main button[type=submit]");
    await p.waitForURL(/created=1/);
    const card = p.getByTestId("deadlines");
    await expect(card).toContainText("First response due in");
    await expect(card).toContainText("Resolution due in");
    return p.url().split("?")[0];
  });

  await test.step("the Issues list shows the deadline, filters and sorts by it", async () => {
    await p.goto(`${W}/issues`);
    const row = p.locator("main li", { hasText: "Card charged, no order" });
    await expect(row).toContainText("First response due in");
    await p.goto(`${W}/issues?due=overdue`);
    await shows(p, "text=No issues match these filters.");
    await p.goto(`${W}/issues?sort=attention`);
    await expect(p.locator("main li", { hasText: "Card charged, no order" })).toBeVisible();
  });

  await test.step("recording the first response stops that timer, once", async () => {
    await p.goto(issueUrl);
    await p.click('button:has-text("Record first response")');
    await expect(p.getByTestId("deadlines")).toContainText("First response met");
    await hidden(p, 'button:has-text("Record first response")');
    await shows(p, "li >> text=First response recorded");
  });

  await test.step("waiting on the customer pauses the resolution timer", async () => {
    await p.selectOption("select[name=status]", "waiting_on_customer");
    await p.click('button:has-text("Save changes")');
    await shows(p, "text=Changes saved.");
    await expect(p.getByTestId("deadlines")).toContainText("Resolution paused while waiting on the customer");
  });

  await test.step("category changes, resolving and reopening are in the history", async () => {
    await p.selectOption("select[name=categoryId]", { label: "Billing" });
    await p.selectOption("select[name=status]", "resolved");
    await p.click('button:has-text("Save changes")');
    await shows(p, "text=Changes saved.");
    await shows(p, "text=Category changed from No category to Billing");
    await shows(p, "text=Resolved (was Waiting on customer)");
    await expect(p.getByTestId("deadlines")).toContainText("Resolution met");

    await p.selectOption("select[name=status]", "open");
    await p.click('button:has-text("Save changes")');
    await shows(p, "text=Reopened as Open");
    await expect(p.getByTestId("deadlines")).toContainText("reopened 1 time");
  });

  await test.step("another company cannot open the issue", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `dueother${id}@example.com`);
    await createOrg(B, "Other Due Co", slugB);
    expect((await B.goto(issueUrl))?.status()).toBe(404);
  });
});
