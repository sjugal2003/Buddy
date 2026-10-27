import { expect, test } from "@playwright/test";
import { acceptInvite, createOrg, hidden, inviteLink, shows, signUpAndConfirm, stamp } from "./helpers";

// Improvement F. The rules (who may add team members, who is told, repeats,
// summaries, escalations, other companies) are checked in
// supabase/tests/security_test.sql. Here: the Settings controls, a team
// member getting the notification, and another company seeing none of it.

test("team notifications: owner adds a member to a team, the member is told about the team's issue", async ({
  browser,
  baseURL,
}) => {
  const id = stamp();
  const slug = `teamf-${id}`;
  const otherSlug = `teamf-other-${id}`;
  const W = `/w/${slug}`;
  const memberEmail = `teamf-member${id}@example.com`;

  const owner = await signUpAndConfirm(browser, baseURL!, "Olive Owner", `teamf-owner${id}@example.com`);
  await createOrg(owner, "Team F Co", slug);
  const link = await inviteLink(owner, slug, memberEmail);
  const member = await signUpAndConfirm(browser, baseURL!, "Mo Member", memberEmail, { canCreateCompany: false });
  await acceptInvite(member, link, slug);

  await test.step("owner adds a team and puts the member in it", async () => {
    await owner.goto(`${W}/settings`);
    const form = owner.locator('form:has(button:has-text("Add team"))');
    await form.locator("input[name=name]").fill("Payments");
    await form.locator("input[name=color]").fill("#10b981");
    await form.locator('button:has-text("Add team")').click();
    await shows(owner, 'text=Team "Payments" added.');
    await shows(owner, "text=Nobody yet.");
    await owner.getByLabel("Add a member to Payments").selectOption({ label: "Mo Member" });
    await owner.click('button:has-text("Add to team")');
    await shows(owner, "text=Team member added.");
    await expect(owner.getByRole("button", { name: "Remove Mo Member from Payments" })).toBeVisible();
  });

  await test.step("a member sees who is in the team but cannot change it", async () => {
    await member.goto(`${W}/settings`);
    await shows(member, "text=Members: Mo Member");
    await hidden(member, 'button:has-text("Add to team")');
  });

  const issueUrl = await test.step("owner creates an issue for the team", async () => {
    await owner.goto(`${W}/issues/new`);
    await owner.fill("input[name=customerName]", "Pat Example");
    await owner.fill("input[name=subject]", "Charged twice");
    await owner.fill("textarea[name=message]", "Secret customer words.");
    await owner.selectOption("select[name=teamId]", { label: "Payments" });
    await owner.click("main button[type=submit]");
    await owner.waitForURL(/created=1/);
    return new URL(owner.url()).pathname;
  });

  await test.step("the team member is notified, without the customer's words", async () => {
    await member.goto(W);
    await expect(member.getByTestId("notification-count")).toHaveText("1");
    await member.goto(`${W}/notifications`);
    const item = member.getByTestId("notification-item");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("New issue for Payments");
    await expect(item).toContainText("Your team");
    await expect(member.getByTestId("notification-list")).not.toContainText("Secret customer words.");
    await member.click("text=New issue for Payments");
    await member.waitForURL(`**${issueUrl}`);
  });

  await test.step("the owner who made the change is not notified about it", async () => {
    await owner.goto(`${W}/notifications`);
    await shows(owner, '[data-testid="notifications-empty"]');
  });

  await test.step("another company sees none of it", async () => {
    const other = await signUpAndConfirm(browser, baseURL!, "Bea Other", `teamf-other${id}@example.com`);
    await createOrg(other, "Other Co", otherSlug);
    await other.goto(`/w/${otherSlug}/notifications`);
    await shows(other, '[data-testid="notifications-empty"]');
    const response = await other.goto(`${W}/settings`);
    expect(response?.status()).toBe(404);
  });

  await test.step("owner removes the member from the team", async () => {
    await owner.goto(`${W}/settings`);
    await owner.getByRole("button", { name: "Remove Mo Member from Payments" }).click();
    await shows(owner, "text=Team member removed.");
    await shows(owner, "text=Nobody yet.");
  });
});
