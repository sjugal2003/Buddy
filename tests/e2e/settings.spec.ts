import { expect, test, type Page } from "@playwright/test";
import { acceptInvite, createOrg, hidden, inviteLink, shows, signUpAndConfirm, stamp } from "./helpers";

test("settings: company profile, teams, categories and who may change them", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `acme-${id}`;
  const slugB = `other-${id}`;
  const emailM = `member${id}@example.com`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `owner${id}@example.com`);
  await createOrg(p, "Acme Test", slugA);

  await test.step("settings start with no teams or categories", async () => {
    await p.click("nav[aria-label=Workspace] >> text=Settings");
    await p.waitForURL(`**/w/${slugA}/settings`);
    await shows(p, "text=No teams yet.");
    await shows(p, "text=No categories yet.");
  });

  await test.step("a bad target is rejected and the typed text is kept", async () => {
    await p.fill("input[name=industry]", "Broadband");
    await p.fill("input[name=targetLow]", "0");
    await p.click('button:has-text("Save settings")');
    await shows(p, "text=Use at least 1 hour.");
    await expect(p.locator("input[name=industry]")).toHaveValue("Broadband");
  });

  await test.step("owner saves the company profile and targets, kept after reloading", async () => {
    await p.fill("input[name=targetLow]", "48");
    await p.fill("input[name=targetCritical]", "2");
    await p.click('button:has-text("Save settings")');
    await shows(p, "text=Settings saved.");
    await p.reload();
    await expect(p.locator("input[name=targetLow]")).toHaveValue("48");
    await expect(p.locator("input[name=industry]")).toHaveValue("Broadband");
  });

  const addTeam = async (name: string, color: string) => {
    const form = p.locator('form:has(button:has-text("Add team"))');
    await form.locator("input[name=name]").fill(name);
    await form.locator("input[name=leadName]").fill(`Lead ${name}`);
    await form.locator("input[name=color]").fill(color);
    await form.locator('button:has-text("Add team")').click();
  };

  await test.step("owner adds, renames and cannot duplicate teams", async () => {
    await addTeam("Payments", "#10b981");
    await shows(p, 'text=Team "Payments" added.');
    await addTeam("Support", "#f59e0b");
    await shows(p, 'text=Team "Support" added.');
    await addTeam("Payments", "#000000");
    await shows(p, "text=There is already a team with this name.");
    const row = p.locator('li:has(input[name=name][value="Support"])');
    await row.locator("input[name=name]").fill("Customer Support");
    await row.locator('button:has-text("Save")').click();
    await shows(p, "text=Team saved.");
  });

  await test.step("owner adds categories and cannot duplicate them", async () => {
    for (const name of ["Billing", "Access"]) {
      await p.fill("#new-category", name);
      await p.click('button:has-text("Add category")');
      await shows(p, `text=Category "${name}" added.`);
    }
    await p.fill("#new-category", "Billing");
    await p.click('button:has-text("Add category")');
    await shows(p, "text=There is already a category with this name.");
  });

  const issueUrl = await test.step("issues get a team and category, and keep typed text on errors", async () => {
    await p.goto(`/w/${slugA}/issues/new`);
    await p.fill("input[name=customerName]", "Priya Shah");
    await p.fill("textarea[name=message]", "Charged twice for October.");
    await p.click("main button[type=submit]");
    await shows(p, "text=Enter a subject.");
    await expect(p.locator("textarea[name=message]")).toHaveValue("Charged twice for October.");
    await p.fill("input[name=subject]", "Double charge");
    await p.selectOption("select[name=teamId]", { label: "Payments" });
    await p.selectOption("select[name=categoryId]", { label: "Billing" });
    await p.click("main button[type=submit]");
    await p.waitForURL(/created=1/);
    await shows(p, "text=Payments");
    await shows(p, 'span:has-text("Billing")');
    return p.url().split("?")[0];
  });

  await test.step("changing the team and category is saved and shown in history", async () => {
    await p.selectOption("select[name=teamId]", { label: "Customer Support" });
    await p.selectOption("select[name=categoryId]", { label: "Access" });
    await p.click('button:has-text("Save changes")');
    await shows(p, "text=Moved to team Customer Support");
    await expect(p.locator("select[name=categoryId] option:checked")).toHaveText("Access");
  });

  const teamFilter = async (label: string) => {
    await p.selectOption("select[name=team]", { label });
    await p.click('button:has-text("Filter")');
    await p.waitForLoadState("networkidle");
  };

  await test.step("the team filter shows only matching issues", async () => {
    await p.goto(`/w/${slugA}/issues`);
    await teamFilter("Customer Support");
    await shows(p, "text=Double charge");
    await teamFilter("Payments");
    await shows(p, "text=No issues match these filters.");
    await teamFilter("No team");
    await shows(p, "text=No issues match these filters.");
  });

  await test.step("deleting a team and category clears them from issues", async () => {
    await p.goto(`/w/${slugA}/settings`);
    for (const name of ["Access", "Customer Support"]) {
      const row = `li:has(input[name=name][value="${name}"])`;
      await p.locator(row).locator('button:has-text("Delete")').click();
      await expect(p.locator(row)).toHaveCount(0);
    }
    await p.reload();
    await hidden(p, 'input[value="Access"]');
    await hidden(p, 'input[value="Customer Support"]');
    await p.goto(issueUrl);
    await shows(p, "text=Save changes");
    await expect(p.locator("select[name=teamId]")).toHaveValue("");
    await expect(p.locator("select[name=categoryId]")).toHaveValue("");
  });

  let M: Page;
  await test.step("a member sees settings read-only", async () => {
    const link = await inviteLink(p, slugA, emailM);
    M = await signUpAndConfirm(browser, baseURL!, "Mia Member", emailM);
    await acceptInvite(M, link, slugA);
    await M.goto(`/w/${slugA}/settings`);
    await shows(M, "text=Only owners and admins can change these settings.");
    await shows(M, "text=Payments");
    await hidden(M, 'button:has-text("Add team")');
    await hidden(M, 'button:has-text("Save settings")');
  });

  await test.step("a member can give an issue to a team", async () => {
    await M.goto(issueUrl);
    await M.selectOption("select[name=teamId]", { label: "Payments" });
    await M.click('button:has-text("Save changes")');
    await shows(M, "text=Moved to team Payments");
  });

  await test.step("another company sees none of these teams or categories", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `other${id}@example.com`);
    await createOrg(B, "Other Co", slugB);
    await B.goto(`/w/${slugB}/settings`);
    await shows(B, "text=No teams yet.");
    await hidden(B, "text=Payments");
    await hidden(B, 'input[value="Billing"]');
    expect((await B.goto(`/w/${slugA}/settings`))?.status()).toBe(404);
    await B.goto(`/w/${slugB}/issues/new`);
    await expect(B.locator("select[name=teamId] option")).toHaveCount(1);
  });
});
