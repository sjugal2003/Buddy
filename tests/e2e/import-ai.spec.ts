import { expect, test, type Page } from "@playwright/test";
import { acceptInvite, createOrg, inviteLink, signUpAndConfirm, stamp } from "./helpers";

// AI for imported issues: nothing runs until the person confirms, the batch
// never goes over the monthly limit, finished issues are not analysed twice,
// members cannot start a batch and other companies are untouched. Uses the
// free test analyser (BUDDY_AI_MODE=fake), never a paid service.

const csv = [
  "ID,Name,Subject,Message,Received",
  "A-1,Asha Test,Refund,I was charged twice and want a refund.,2026-10-20 09:00",
  "A-2,Ben Test,Thanks,Thanks for the quick help.,2026-10-21 10:00",
  "A-3,Cara Test,Login,The app is not working after the update.,2026-10-22 11:00",
].join("\n");

async function setAi(page: Page, slug: string, enabled: boolean, limit: number) {
  await page.goto(`/w/${slug}/settings`);
  if (enabled) await page.check("input[name=enabled]");
  else await page.uncheck("input[name=enabled]");
  await page.fill("input[name=monthlyLimit]", String(limit));
  await page.click('button:has-text("Save AI settings")');
  await expect(page.getByText(enabled ? "AI analysis switched on." : "AI analysis switched off.")).toBeVisible();
}

async function openPlan(page: Page, slug: string) {
  await page.goto(`/w/${slug}/data-sources`);
  await page.getByTestId("import-row").getByTestId("import-ai-open").click();
}

test("AI for imported issues: confirm first, stay inside the monthly limit, owners and admins only", async ({
  browser,
  baseURL,
}) => {
  const id = stamp();
  const slug = `impai-${id}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `impai${id}@example.com`);
  await createOrg(p, "Import AI Co", slug);

  await test.step("import three issues; with AI off the button says so and nothing runs", async () => {
    await p.goto(`/w/${slug}/data-sources`);
    await p.getByTestId("csv-file").setInputFiles({ name: "ai.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await p.getByLabel(/Open issues/).check();
    await p.getByRole("button", { name: "Import 3 rows" }).click();
    await expect(p.getByTestId("result-imported")).toHaveText("3");
    await p.getByTestId("import-result").getByTestId("import-ai-open").click();
    await expect(p.getByTestId("import-ai-error")).toContainText("AI analysis is switched off");
  });

  await test.step("with a limit of 2, only 2 of the 3 are offered, and nothing runs before Confirm", async () => {
    await setAi(p, slug, true, 2);
    await openPlan(p, slug);
    await expect(p.getByTestId("import-ai-waiting")).toHaveText("3");
    await expect(p.getByTestId("import-ai-usage")).toHaveText("0 of 2 used, 2 left");
    await expect(p.getByTestId("import-ai-plan")).toContainText("This analyses 2 issues");
    await expect(p.getByTestId("import-ai-plan")).toContainText("The other 1 wait");
    // Cancel: still nothing used.
    await p.getByRole("button", { name: "Cancel" }).click();
    await p.goto(`/w/${slug}/settings`);
    await expect(p.getByTestId("ai-usage")).toHaveText("0 of 2");
  });

  await test.step("confirming analyses 2 and fills their values", async () => {
    await openPlan(p, slug);
    await p.getByTestId("import-ai-confirm-button").click();
    await expect(p.getByTestId("import-ai-done")).toContainText("Analysed 2 issues. 1 still waiting for the AI.");
    await p.goto(`/w/${slug}/settings`);
    await expect(p.getByTestId("ai-usage")).toContainText("2 of 2");
    // The oldest (the refund) went first: the test analyser calls it a negative complaint.
    await p.goto(`/w/${slug}/issues?q=Refund`);
    await expect(p.getByTestId("issue-row")).toContainText("AI suggested");
    await expect(p.getByTestId("issue-row")).toContainText("Negative");
  });

  await test.step("with the month used up, the button says so and offers nothing", async () => {
    await openPlan(p, slug);
    await expect(p.getByTestId("import-ai-waiting")).toHaveText("1");
    await expect(p.getByTestId("import-ai-confirm")).toContainText("used up");
    await expect(p.getByTestId("import-ai-confirm-button")).toHaveCount(0);
  });

  await test.step("after raising the limit only the last issue is analysed, never one twice", async () => {
    await setAi(p, slug, true, 10);
    await openPlan(p, slug);
    await expect(p.getByTestId("import-ai-waiting")).toHaveText("1");
    await p.getByTestId("import-ai-confirm-button").click();
    await expect(p.getByTestId("import-ai-done")).toContainText("Analysed 1 issue.");
    await openPlan(p, slug);
    await expect(p.getByTestId("import-ai-confirm")).toContainText("Every issue from this import already has an AI analysis.");
    await p.goto(`/w/${slug}/settings`);
    await expect(p.getByTestId("ai-usage")).toContainText("3 of 10");
  });

  await test.step("a member sees the history but no AI button", async () => {
    const emailM = `impaimember${id}@example.com`;
    const link = await inviteLink(p, slug, emailM);
    const M = await signUpAndConfirm(browser, baseURL!, "Mia Member", emailM);
    await acceptInvite(M, link, slug);
    await M.goto(`/w/${slug}/data-sources`);
    await expect(M.getByTestId("import-row")).toHaveCount(1);
    await expect(M.getByTestId("import-ai-open")).toHaveCount(0);
  });

  await test.step("another company cannot see or analyse the import", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `impaiother${id}@example.com`);
    await createOrg(B, "Other Import AI Co", `impai-other-${id}`);
    await B.goto(`/w/impai-other-${id}/data-sources`);
    await expect(B.getByTestId("imports-empty")).toBeVisible();
    expect((await B.goto(`/w/${slug}/data-sources`))?.status()).toBe(404);
  });
});
