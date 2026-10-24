import { expect, test } from "@playwright/test";
import { acceptInvite, createOrg, hidden, inviteLink, shows, signUpAndConfirm, stamp } from "./helpers";

test("AI settings: off by default, owners switch it on, members and other companies cannot", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `ai-${id}`;
  const slugB = `ai-other-${id}`;
  const emailM = `aimember${id}@example.com`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `aiowner${id}@example.com`);
  await createOrg(p, "AI Test Co", slugA);

  await test.step("a new company starts with AI off and 0 of 500 used", async () => {
    await p.goto(`/w/${slugA}/settings`);
    await expect(p.getByTestId("ai-status")).toHaveText("Off");
    await expect(p.getByTestId("ai-usage")).toHaveText("0 of 500");
    await expect(p.locator("input[name=enabled]")).not.toBeChecked();
    await shows(p, "text=Test analyser (no real AI, free)");
  });

  await test.step("a limit above 2,000 is refused and nothing changes", async () => {
    await p.check("input[name=enabled]");
    await p.fill("input[name=monthlyLimit]", "5000");
    await p.click('button:has-text("Save AI settings")');
    await shows(p, "text=Use 2,000 or fewer.");
    await hidden(p, "text=AI analysis switched on.");
    await p.reload();
    await expect(p.getByTestId("ai-status")).toHaveText("Off");
  });

  await test.step("the owner switches AI on with a lower limit, kept after reloading", async () => {
    await p.check("input[name=enabled]");
    await p.fill("input[name=monthlyLimit]", "100");
    await p.click('button:has-text("Save AI settings")');
    await shows(p, "text=AI analysis switched on.");
    await p.reload();
    await expect(p.getByTestId("ai-status")).toHaveText("On");
    await expect(p.getByTestId("ai-usage")).toHaveText("0 of 100");
    await expect(p.locator("input[name=enabled]")).toBeChecked();
  });

  await test.step("a member sees the AI settings read-only", async () => {
    const link = await inviteLink(p, slugA, emailM);
    const M = await signUpAndConfirm(browser, baseURL!, "Mia Member", emailM);
    await acceptInvite(M, link, slugA);
    await M.goto(`/w/${slugA}/settings`);
    await expect(M.getByTestId("ai-status")).toHaveText("On");
    await hidden(M, 'button:has-text("Save AI settings")');
    await hidden(M, "input[name=enabled]");
  });

  await test.step("another company keeps its own setting and cannot open this one", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `aiother${id}@example.com`);
    await createOrg(B, "AI Other Co", slugB);
    await B.goto(`/w/${slugB}/settings`);
    await expect(B.getByTestId("ai-status")).toHaveText("Off");
    await expect(B.getByTestId("ai-usage")).toHaveText("0 of 500");
    expect((await B.goto(`/w/${slugA}/settings`))?.status()).toBe(404);
  });
});
