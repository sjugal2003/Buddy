import { expect, test } from "@playwright/test";
import { createOrg, hidden, shows, signUpAndConfirm, stamp } from "./helpers";

// Escalations are raised by the database check (all its rules are tested in
// supabase/tests/security_test.sql). Here: the Settings card, Check now,
// the badge, Acknowledge, the history, and that another company stays out.

test("escalations: settings, check now, badge, acknowledge", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `esc-${id}`;
  const slugB = `esc-other-${id}`;
  const W = `/w/${slugA}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `esc${id}@example.com`);
  await createOrg(p, "Esc Co", slugA);

  await test.step("a check needs a condition switched on, and thresholds are checked", async () => {
    await p.goto(`${W}/settings`);
    await expect(p.getByTestId("escalation-last-run")).toHaveText("Never run");
    await shows(p, "text=Not running. Use Check now.");
    await shows(p, "text=Not set up (Phase 6)");
    await p.click('button:has-text("Check now")');
    await shows(p, "text=Switch on at least one escalation condition first.");
    await p.fill("input[name=noUpdateHours]", "0");
    await p.click('button:has-text("Save escalation settings")');
    await shows(p, "text=Use 1 or more.");
    await p.fill("input[name=noUpdateHours]", "72");
    await p.check("input[name=urgentNoTeam]");
    await p.fill("input[name=urgentNoTeamHours]", "0");
    await p.click('button:has-text("Save escalation settings")');
    await shows(p, "text=Escalation settings saved.");
    await p.reload();
    await expect(p.locator("input[name=urgentNoTeam]")).toBeChecked();
    await expect(p.locator("input[name=urgentNoTeamHours]")).toHaveValue("0");
  });

  const issueUrl = await test.step("a critical issue with no team", async () => {
    await p.goto(`${W}/issues/new`);
    await p.fill("input[name=customerName]", "Pat Urgent");
    await p.fill("input[name=subject]", "Site down for everyone");
    await p.fill("textarea[name=message]", "Nobody can log in.");
    await p.selectOption("select[name=urgency]", "critical");
    await p.click("main button[type=submit]");
    await p.waitForURL(/created=1/);
    await hidden(p, '[data-testid="escalation-badge"]');
    return p.url().split("?")[0];
  });

  await test.step("Check now escalates it once", async () => {
    await p.goto(`${W}/settings`);
    await p.click('button:has-text("Check now")');
    await shows(p, "text=Checked 1 open issue: 1 new escalation.");
    await p.click('button:has-text("Check now")');
    await shows(p, "text=Checked 1 open issue: no new escalations.");
    await expect(p.getByTestId("escalation-last-run")).toContainText("(Check now). Checked 1 open issue");
  });

  await test.step("the issue shows the escalation without changing its status", async () => {
    await p.goto(`${W}/issues`);
    await expect(p.locator("main li", { hasText: "Site down for everyone" }).getByTestId("escalation-badge")).toHaveText(
      "Escalated · level 2",
    );
    await p.goto(issueUrl);
    await expect(p.getByTestId("escalation-badge")).toHaveText("Escalated · level 2");
    const card = p.getByTestId("escalations");
    await expect(card).toContainText("Level 2 · Critical or High urgency with no team");
    await expect(card).toContainText("Critical issue still has no team after");
    await expect(p.locator("select[name=status]")).toHaveValue("new");
    await shows(p, "li >> text=Escalated (level 2): Critical issue still has no team after");
  });

  await test.step("acknowledging clears the badge and keeps the record", async () => {
    await p.fill('input[name="note"]', "Calling them now");
    await p.click('button:has-text("Acknowledge")');
    await hidden(p, '[data-testid="escalation-badge"]');
    await expect(p.getByTestId("escalations")).toContainText("by Alice Owner: “Calling them now”");
    await hidden(p, 'button:has-text("Acknowledge")');
    await shows(p, "text=Escalation acknowledged (Critical or High urgency with no team): “Calling them now”");
  });

  await test.step("another company sees none of it", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `escother${id}@example.com`);
    await createOrg(B, "Other Esc Co", slugB);
    expect((await B.goto(issueUrl))?.status()).toBe(404);
    await B.goto(`/w/${slugB}/settings`);
    await expect(B.getByTestId("escalation-last-run")).toHaveText("Never run");
  });
});
