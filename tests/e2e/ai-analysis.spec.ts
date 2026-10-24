import { expect, test } from "@playwright/test";
import { createOrg, hidden, shows, signUpAndConfirm, stamp } from "./helpers";

// Uses the free test analyser (BUDDY_AI_MODE=fake, see playwright.config.ts):
// it reads keywords, so "charged twice ... refund" is a negative complaint
// of medium urgency, and a category named in the message is picked.

test("AI analysis: fills what was left to it, suggests the rest, and stays inside the company", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `analyse-${id}`;
  const slugB = `analyse-other-${id}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `analyse${id}@example.com`);
  await createOrg(p, "Analyse Co", slugA);

  await test.step("with AI off there is no 'Let AI decide' and the panel says it is off", async () => {
    await p.goto(`/w/${slugA}/issues/new`);
    await hidden(p, 'option[value="ai"]');
    await p.fill("input[name=customerName]", "Sam Off");
    await p.fill("input[name=subject]", "Question");
    await p.fill("textarea[name=message]", "How do I change my plan?");
    await p.click("main button[type=submit]");
    await p.waitForURL(/created=1/);
    await shows(p, "text=AI analysis is off for this company.");
  });

  await test.step("the owner adds a Billing category and switches AI on", async () => {
    await p.goto(`/w/${slugA}/settings`);
    await p.fill("#new-category", "Billing");
    await p.click('button:has-text("Add category")');
    await shows(p, 'text=Category "Billing" added.');
    await p.check("input[name=enabled]");
    await p.click('button:has-text("Save AI settings")');
    await shows(p, "text=AI analysis switched on.");
  });

  const issueUrl = await test.step("fields left to the AI are filled in after saving", async () => {
    await p.goto(`/w/${slugA}/issues/new`);
    await expect(p.locator("select[name=sentiment]")).toHaveValue("ai");
    await p.fill("input[name=customerName]", "Priya Shah");
    await p.fill("input[name=subject]", "Charged twice");
    await p.fill("textarea[name=message]", "I was charged twice on my billing statement. Please refund one.");
    await p.click("main button[type=submit]");
    await p.waitForURL(/created=1/);
    const panel = p.getByTestId("ai-panel");
    await expect(panel).toContainText("AI suggested");
    await expect(panel).toContainText("Test analyser: Charged twice (complaint).");
    // The badges at the top now show the AI's values.
    await shows(p, 'main span:text-is("Negative")');
    await shows(p, 'main span:text-is("Complaint")');
    await shows(p, 'main span:text-is("Billing")');
    await shows(p, "text=Analysed by AI (suggested urgency Medium)");
    await shows(p, "text=Accepted AI type: Question → Complaint");
    await expect(p).not.toHaveURL(/analyse=/);
    return p.url().split("?")[0];
  });

  await test.step("reloading does not analyse again, and a quick retry is refused", async () => {
    await p.reload();
    await expect(p.locator("text=Analysed by AI")).toHaveCount(1);
    await p.click('button:has-text("Analyse again")');
    await shows(p, "text=Please wait 30 seconds before analysing this issue again.");
  });

  await test.step("what a person chose is kept; the AI's view gets an Accept button", async () => {
    await p.goto(`/w/${slugA}/issues/new`);
    await p.fill("input[name=customerName]", "Lee Chosen");
    await p.fill("input[name=subject]", "Refund problem");
    await p.fill("textarea[name=message]", "There is a problem with my refund.");
    await p.selectOption("select[name=urgency]", "critical");
    await p.selectOption("select[name=sentiment]", "positive");
    await p.selectOption("select[name=intent]", "question");
    await p.click("main button[type=submit]");
    await p.waitForURL(/created=1/);
    const panel = p.getByTestId("ai-panel");
    await expect(panel).toContainText("AI suggested");
    await shows(p, 'main span:text-is("Critical")');
    await shows(p, 'main span:text-is("Positive")');
    await panel.locator('button:has-text("Accept urgency")').click();
    await shows(p, "text=Accepted AI urgency: Critical → Medium");
    await shows(p, 'main span:text-is("Medium")');
    await hidden(p, 'button:has-text("Accept urgency")');
    await expect(panel.locator('button:has-text("Accept sentiment")')).toBeVisible();
  });

  await test.step("Settings counts the analyses", async () => {
    await p.goto(`/w/${slugA}/settings`);
    await expect(p.getByTestId("ai-usage")).toContainText("2 of 500");
  });

  await test.step("another company cannot see the issue or its analysis", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `analyseother${id}@example.com`);
    await createOrg(B, "Other Co", slugB);
    expect((await B.goto(issueUrl))?.status()).toBe(404);
    await B.goto(`/w/${slugB}/settings`);
    await expect(B.getByTestId("ai-usage")).toHaveText("0 of 500");
  });
});
