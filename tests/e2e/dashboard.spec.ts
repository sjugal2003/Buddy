import { expect, test, type Page } from "@playwright/test";
import { createOrg, signUpAndConfirm, stamp } from "./helpers";

// The workspace home's numbers come only from the company's own issues, and
// each card's number matches the Issues list it links to.

const cards = ["card-urgent", "card-due-soon", "card-breached", "card-escalated", "card-no-team", "card-waiting"] as const;

async function cardValues(page: Page) {
  const values: Record<string, string> = {};
  for (const card of cards) values[card] = (await page.getByTestId(card).locator("p").nth(1).textContent()) ?? "";
  return values;
}

async function newIssue(page: Page, W: string, subject: string, urgency: string) {
  await page.goto(`${W}/issues/new`);
  await page.fill("input[name=customerName]", "Dana Customer");
  await page.fill("input[name=subject]", subject);
  await page.fill("textarea[name=message]", "Details of the problem.");
  await page.selectOption("select[name=urgency]", urgency);
  await page.click("main button[type=submit]");
  await page.waitForURL(/created=1/);
}

test("dashboard: zeros for a new company, real counts that match the Issues list", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `dash-${id}`;
  const slugB = `dash-other-${id}`;
  const W = `/w/${slugA}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `dash${id}@example.com`);
  await createOrg(p, "Dash Co", slugA);

  await test.step("a brand-new company sees zeros and a nothing-yet note", async () => {
    await expect(p.getByTestId("open-issue-count")).toHaveText("No open issues");
    await expect(p.getByTestId("dashboard-empty")).toContainText("Nothing yet");
    expect(Object.values(await cardValues(p))).toEqual(["0", "0", "0", "0", "0", "0"]);
    await expect(p.getByTestId("week-opened")).toHaveText("0");
    await expect(p.getByTestId("week-resolved")).toHaveText("0");
    await expect(p.getByTestId("recent-activity-empty")).toBeVisible();
    // The Members card is still on the home page.
    await expect(p.locator("section", { hasText: "Members" }).first()).toContainText("Alice Owner");
  });

  await test.step("add issues and escalate one", async () => {
    // Critical with no team: first response due within the hour.
    await newIssue(p, W, "Site down for everyone", "critical");
    // Low, then waiting on the customer.
    await newIssue(p, W, "Question about invoices", "low");
    await p.selectOption("select[name=status]", "waiting_on_customer");
    await p.click('button:has-text("Save changes")');
    await expect(p.getByText("Changes saved.")).toBeVisible();
    // Resolved straight away: counts as opened and resolved this week, never as open.
    await newIssue(p, W, "Password reset worked", "medium");
    await p.selectOption("select[name=status]", "resolved");
    await p.click('button:has-text("Save changes")');
    await expect(p.getByText("Changes saved.")).toBeVisible();

    await p.goto(`${W}/settings`);
    await p.check("input[name=urgentNoTeam]");
    await p.fill("input[name=urgentNoTeamHours]", "0");
    await p.click('button:has-text("Save escalation settings")');
    await expect(p.getByText("Escalation settings saved.")).toBeVisible();
    await p.click('button:has-text("Check now")');
    await expect(p.getByText("Checked 2 open issues: 1 new escalation.", { exact: true })).toBeVisible();
  });

  await test.step("the cards count the company's issues", async () => {
    await p.goto(W);
    await expect(p.getByTestId("open-issue-count")).toHaveText("2 open issues");
    await expect(p.getByTestId("dashboard-empty")).toHaveCount(0);
    expect(await cardValues(p)).toEqual({
      "card-urgent": "1",
      "card-due-soon": "1",
      "card-breached": "0",
      "card-escalated": "1",
      "card-no-team": "2",
      "card-waiting": "1",
    });
    await expect(p.getByTestId("week-opened")).toHaveText("3");
    await expect(p.getByTestId("week-resolved")).toHaveText("1");
    const recent = p.getByTestId("recent-activity");
    await expect(recent).toContainText("Site down for everyone: Escalated (level 2)");
    await expect(recent).toContainText("Password reset worked: Resolved");
    expect(await recent.locator("li").count()).toBeLessThanOrEqual(10);
  });

  await test.step("each card links to an Issues list with the same number of issues", async () => {
    const values = await cardValues(p);
    for (const card of cards) {
      await p.goto(W);
      await p.getByTestId(card).click();
      await p.waitForURL(/\/issues\?/);
      await expect(p.getByTestId("issue-row")).toHaveCount(Number(values[card]));
    }
    await p.goto(`${W}/issues?escalated=open`);
    await expect(p.getByTestId("issue-row")).toContainText("Site down for everyone");
    await p.goto(`${W}/issues?status=waiting_on_customer`);
    await expect(p.getByTestId("issue-row")).toContainText("Question about invoices");
  });

  await test.step("acknowledging the escalation takes it off the card", async () => {
    await p.goto(`${W}/issues?escalated=open`);
    await p.getByTestId("issue-row").getByRole("link").click();
    await p.click('button:has-text("Acknowledge")');
    await expect(p.getByTestId("escalation-badge")).toHaveCount(0);
    await p.goto(W);
    await expect(p.getByTestId("card-escalated").locator("p").nth(1)).toHaveText("0");
  });

  await test.step("another company sees only its own zeros", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `dashother${id}@example.com`);
    await createOrg(B, "Other Dash Co", slugB);
    expect(Object.values(await cardValues(B))).toEqual(["0", "0", "0", "0", "0", "0"]);
    await expect(B.getByTestId("week-opened")).toHaveText("0");
    await expect(B.getByTestId("recent-activity-empty")).toBeVisible();
    await expect(B.locator("main")).not.toContainText("Site down for everyone");
    expect((await B.goto(W))?.status()).toBe(404);
  });
});
