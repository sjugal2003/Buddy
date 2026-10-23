import { expect, test } from "@playwright/test";
import { acceptInvite, createOrg, hidden, inviteLink, shows, signUpAndConfirm, stamp } from "./helpers";

test("routing rules suggest a team; nothing moves until someone applies it", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `acme-${id}`;
  const slugB = `other-${id}`;
  const emailM = `member${id}@example.com`;
  const W = `/w/${slugA}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `owner${id}@example.com`);
  await createOrg(p, "Acme Test", slugA);

  // Teams and a category to route to.
  await p.goto(`${W}/settings`);
  for (const name of ["Payments", "Support"]) {
    const form = p.locator('form:has(button:has-text("Add team"))');
    await form.locator("input[name=name]").fill(name);
    await form.locator('button:has-text("Add team")').click();
    await shows(p, `text=Team "${name}" added.`);
  }
  await p.fill("#new-category", "Billing");
  await p.click('button:has-text("Add category")');
  await shows(p, 'text=Category "Billing" added.');

  const editor = p.locator('form:has(button:has-text("Add rule"))');
  const firstRule = p.locator("ol > li").first();

  await test.step("routing starts with no rules, and a rule needs a name", async () => {
    await p.click("nav[aria-label=Workspace] >> text=Routing");
    await p.waitForURL(`**${W}/routing`);
    await shows(p, "text=No rules yet.");
    await editor.locator('select[aria-label="Condition 1 field"]').selectOption("category");
    await editor.locator('button:has-text("Add rule")').click();
    await shows(p, "text=Enter a rule name.");
  });

  await test.step("owner adds a category rule and the form empties", async () => {
    await editor.locator("input[name=name]").fill("Billing to Payments");
    await editor.locator("select[name=teamId]").selectOption({ label: "Payments" });
    await editor.locator('button:has-text("Add rule")').click();
    await shows(p, 'text=Rule "Billing to Payments" added.');
    await expect(editor.locator("input[name=name]")).toHaveValue("");
  });

  await test.step("a keyword + urgency rule is saved, described and listed second", async () => {
    await editor.locator("input[name=name]").fill("Refunds to Support");
    await editor.locator("select[name=teamId]").selectOption({ label: "Support" });
    await editor.locator('select[aria-label="Condition 1 field"]').selectOption("keyword");
    await editor.locator('input[aria-label="Condition 1 value"]').fill("refund");
    await editor.locator('button:has-text("Add condition")').click();
    await editor.locator('select[aria-label="Condition 2 field"]').selectOption("urgency");
    await editor.locator('select[aria-label="Condition 2 value"]').selectOption("critical");
    await editor.locator('button:has-text("Add rule")').click();
    await shows(p, 'text=Rule "Refunds to Support" added.');
    await shows(p, 'text=If message contains "refund" or urgency is Critical, suggest');
    await expect(firstRule).toContainText("Billing to Payments");
  });

  const newIssue = async (subject: string, message: string, category?: string) => {
    await p.goto(`${W}/issues/new`);
    await p.fill("input[name=customerName]", "Customer");
    await p.fill("input[name=subject]", subject);
    await p.fill("textarea[name=message]", message);
    if (category) await p.selectOption("select[name=categoryId]", { label: category });
    await p.click("main button[type=submit]");
    await p.waitForURL(/created=1/);
  };

  await test.step("the issue page suggests a team, and applying it gives the issue that team", async () => {
    await newIssue("Charged twice", "Two payments taken.", "Billing");
    await shows(p, "text=suggests Payments");
    await p.click('button:has-text("Apply suggestion")');
    await shows(p, "text=Moved to team Payments");
    await hidden(p, 'button:has-text("Apply suggestion")');
  });

  await test.step("an issue no rule matches says so", async () => {
    await newIssue("Money back", "I want a refund for my order.");
    await newIssue("Hello", "Just saying thanks.");
    await shows(p, "text=No routing rule matches this issue.");
  });

  await test.step("owner moves a rule up, and the order is kept", async () => {
    await p.goto(`${W}/routing`);
    await p.click('button[aria-label="Move Refunds to Support up"]');
    await expect(firstRule).toContainText("Refunds to Support");
    await p.reload();
    await expect(firstRule).toContainText("Refunds to Support");
  });

  await test.step("switched-off rules are ignored when routing", async () => {
    await p.locator('li:has-text("Refunds to Support")').locator('button:has-text("Switch off")').click();
    await shows(p, 'li:has-text("Refunds to Support (off)")');
    await p.click('button:has-text("Route open issues that have no team")');
    await shows(p, "text=No rule matches the open issues without a team.");
  });

  await test.step("routing gives matching issues their team and counts the rest", async () => {
    await p.locator('li:has-text("Refunds to Support")').locator('button:has-text("Switch on")').click();
    await shows(p, 'li:has-text("Refunds to Support") >> button:has-text("Switch off")');
    await p.click('button:has-text("Route open issues that have no team")');
    await shows(p, "text=Routed 1 issue. 1 still have no team because no rule matches them.");
    await p.goto(`${W}/issues?team=unassigned`);
    await shows(p, "text=Hello");
    await hidden(p, "text=Money back");
  });

  await test.step("owner edits a rule", async () => {
    await p.goto(`${W}/routing`);
    const row = p.locator('li:has-text("Billing to Payments")');
    await row.locator('button:has-text("Edit")').click();
    await row.locator("input[name=name]").fill("Billing issues to Payments");
    await row.locator('button:has-text("Save rule")').click();
    await shows(p, "text=Rule saved.");
    await shows(p, "text=Billing issues to Payments");
  });

  await test.step("a team used by a rule cannot be deleted", async () => {
    await p.goto(`${W}/settings`);
    await p.locator('li:has(input[name=name][value="Support"])').locator('button:has-text("Delete")').click();
    await shows(p, "text=Routing rules still send issues to this team.");
  });

  await test.step("owner deletes a rule", async () => {
    await p.goto(`${W}/routing`);
    await p.click('button[aria-label="Delete Refunds to Support"]');
    await expect(p.locator('li:has-text("Refunds to Support")')).toHaveCount(0);
  });

  await test.step("a member sees the rules read-only but can apply a suggestion", async () => {
    const link = await inviteLink(p, slugA, emailM);
    const M = await signUpAndConfirm(browser, baseURL!, "Mia Member", emailM);
    await acceptInvite(M, link, slugA);
    await M.goto(`${W}/routing`);
    await shows(M, "text=Only owners and admins can change them.");
    await shows(M, "text=Billing issues to Payments");
    await hidden(M, 'button:has-text("Edit")');
    await hidden(M, "text=Add a rule");
    await M.goto(`${W}/issues/new`);
    await M.fill("input[name=customerName]", "Customer");
    await M.fill("input[name=subject]", "Invoice wrong");
    await M.fill("textarea[name=message]", "Wrong amount.");
    await M.selectOption("select[name=categoryId]", { label: "Billing" });
    await M.click("main button[type=submit]");
    await M.waitForURL(/created=1/);
    await M.click('button:has-text("Apply suggestion")');
    await shows(M, "text=Moved to team Payments");
  });

  await test.step("another company sees none of these rules", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `other${id}@example.com`);
    await createOrg(B, "Other Co", slugB);
    await B.goto(`/w/${slugB}/routing`);
    await shows(B, "text=No rules yet.");
    await hidden(B, "text=Billing issues to Payments");
    expect((await B.goto(`${W}/routing`))?.status()).toBe(404);
  });
});
