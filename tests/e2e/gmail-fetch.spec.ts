import { expect, test } from "@playwright/test";
import { acceptInvite, createOrg, inviteLink, signUpAndConfirm, stamp } from "./helpers";

// "Fetch new email" with the stand-in for Google (BUDDY_GMAIL_MODE=fake),
// whose inbox holds three made-up emails. No test ever contacts Google.

test("Gmail fetch: new emails become issues once, members and other companies cannot fetch", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `fetch-${id}`;
  const W = `/w/${slug}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `fetch${id}@example.com`);
  await createOrg(p, "Fetch Co", slug);

  await test.step("connect, then fetch: three new emails become issues", async () => {
    await p.goto(`${W}/data-sources`);
    await p.getByTestId("gmail-connect").click();
    await p.waitForURL(/gmail=connected/);
    await expect(p.getByTestId("gmail-last-fetched")).toHaveText("Never");
    await p.getByTestId("gmail-fetch-button").click();
    await expect(p.getByTestId("gmail-fetch-result")).toContainText("Fetched 3 new emails: 3 added as issues.");
    // AI stays a separate step that asks first.
    await expect(p.getByTestId("gmail-fetch-result").getByTestId("import-ai-open")).toBeVisible();
    await expect(p.getByTestId("gmail-last-fetched")).not.toHaveText("Never");
    const history = p.getByTestId("import-row");
    await expect(history).toHaveCount(1);
    await expect(history).toContainText("Gmail");
    await expect(history).toContainText("test.inbox@example.com");
    await expect(history).toContainText("Finished");
  });

  await test.step("the issues carry the sender, subject, text and source", async () => {
    await p.goto(`${W}/issues`);
    await expect(p.getByTestId("issue-row")).toHaveCount(3);
    await p.goto(`${W}/issues?q=double`);
    await p.getByTestId("issue-row").getByRole("link").click();
    await expect(p.locator("main")).toContainText("Refund for a double charge");
    await expect(p.locator("main")).toContainText("Priya Shah");
    await expect(p.getByTestId("customer-email")).toHaveText("priya.shah@example.com");
    await expect(p.getByTestId("issue-origin")).toContainText("Gmail");
    await expect(p.getByTestId("issue-origin")).not.toContainText("(ID");
    await expect(p.locator("main")).toContainText("I was charged twice this month.");
    await p.goto(`${W}/issues?q=crashing`);
    await p.getByTestId("issue-row").getByRole("link").click();
    await expect(p.locator("main")).toContainText("The app crashes when I open settings.");
    await expect(p.locator("main")).toContainText("Tom & family");
  });

  await test.step("fetching again adds nothing", async () => {
    await p.goto(`${W}/data-sources`);
    await p.getByTestId("gmail-fetch-button").click();
    await expect(p.getByTestId("gmail-fetch-result")).toContainText("No new email since the last fetch.");
    await expect(p.getByTestId("import-row")).toHaveCount(2);
    await p.goto(`${W}/issues`);
    await expect(p.getByTestId("issue-row")).toHaveCount(3);
  });

  await test.step("a member sees the inbox but cannot fetch", async () => {
    const emailM = `fetchmember${id}@example.com`;
    const link = await inviteLink(p, slug, emailM);
    const M = await signUpAndConfirm(browser, baseURL!, "Mia Member", emailM);
    await acceptInvite(M, link, slug);
    await M.goto(`${W}/data-sources`);
    await expect(M.getByTestId("gmail-address")).toHaveText("test.inbox@example.com");
    await expect(M.getByTestId("gmail-fetch-not-allowed")).toBeVisible();
    await expect(M.getByTestId("gmail-fetch-button")).toHaveCount(0);
  });

  await test.step("another company has nothing to fetch and sees none of these issues", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `fetchother${id}@example.com`);
    await createOrg(B, "Other Fetch Co", `fetch-other-${id}`);
    await B.goto(`/w/fetch-other-${id}/data-sources`);
    await expect(B.getByTestId("gmail-not-connected")).toBeVisible();
    await expect(B.getByTestId("gmail-fetch-button")).toHaveCount(0);
    await B.goto(`/w/fetch-other-${id}/issues`);
    await expect(B.getByTestId("issue-row")).toHaveCount(0);
  });
});
