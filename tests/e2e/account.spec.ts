import { expect, test } from "@playwright/test";
import pg from "pg";
import { acceptInvite, createOrg, hidden, inviteLink, PASSWORD, shows, signUpAndConfirm, stamp, TEST_DB } from "./helpers";

// Phase 7 stage 37: Forgot password, limits on repeated actions, cancelling an
// invitation and deleting your own account (rules in supabase/tests/security_test.sql).

/** The newest "reset password" email for this address in the local email catcher. */
async function resetLink(email: string) {
  const mail = process.env.E2E_MAIL_URL;
  for (let i = 0; i < 40; i++) {
    const query = encodeURIComponent(`to:${email} subject:reset`);
    const list = await (await fetch(`${mail}/api/v1/search?query=${query}`)).json();
    if (list.messages?.length) {
      const message = await (await fetch(`${mail}/api/v1/message/${list.messages[0].ID}`)).json();
      return (message.HTML as string).match(/href="([^"]+)"/)![1].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No reset email arrived for ${email}`);
}

test("forgot password: a reset link lets you choose a new password", async ({ browser, baseURL }) => {
  const id = stamp();
  const email = `reset${id}@example.com`;
  const newPassword = "brand-new-password-7";
  const first = await signUpAndConfirm(browser, baseURL!, "Rita Reset", email);
  await first.context().close();

  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  await test.step("the sign-in page links to Forgot password, which never says whether an account exists", async () => {
    await page.goto("/login");
    await page.click("text=Forgot password?");
    await page.waitForURL("**/forgot-password");
    await page.fill("input[name=email]", "not-an-email");
    await page.click("button[type=submit]");
    await shows(page, "text=Enter a valid email address.");
    await page.fill("input[name=email]", `nobody${id}@example.com`);
    await page.click("button[type=submit]");
    await shows(page, "text=If an account uses this email");
    await page.fill("input[name=email]", email);
    await page.click("button[type=submit]");
    await shows(page, "text=If an account uses this email");
  });

  await test.step("the link opens the new-password form, which checks both boxes match", async () => {
    await page.goto(await resetLink(email));
    await page.waitForURL("**/reset-password");
    await page.fill("input[name=password]", newPassword);
    await page.fill("input[name=confirm]", "something-else-1");
    await page.click("button[type=submit]");
    await shows(page, "text=The two passwords don't match.");
    // The form empties after each try, like Buddy's other forms.
    await page.fill("input[name=password]", newPassword);
    await page.fill("input[name=confirm]", newPassword);
    await page.click("button[type=submit]");
    await shows(page, "text=Your password has been changed.");
  });

  await test.step("the old password stops working and the new one works", async () => {
    await context.clearCookies();
    await page.goto("/login");
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", PASSWORD);
    await page.click("button[type=submit]");
    await expect(page.locator("form p[role=alert]")).toContainText("don't match");
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", newPassword);
    await page.click("button[type=submit]");
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  });

  await test.step("signed out, the new-password page sends you to sign in", async () => {
    const visitor = await browser.newContext({ baseURL });
    const anon = await visitor.newPage();
    await anon.goto("/reset-password");
    await anon.waitForURL("**/login?next=%2Freset-password");
    await visitor.close();
  });
  await context.close();
});

test("limits: too many invitations in an hour are refused with a plain message", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `limits-${id}`;
  const email = `limits${id}@example.com`;
  const p = await signUpAndConfirm(browser, baseURL!, "Lina Limit", email);
  await createOrg(p, "Limits Co", slug);

  // As if this person had already created 30 invitations in the last hour.
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  await client.query(
    `insert into private.rate_limit_events (user_id, action)
     select id, 'invite' from auth.users, generate_series(1, 30) where email = $1`,
    [email],
  );
  await client.end();

  await p.goto(`/w/${slug}`);
  await p.fill("input[name=email]", `colleague${id}@example.com`);
  await p.click('button:has-text("Create invite link")');
  await shows(p, "text=Too many invitations in the last hour (the limit is 30)");
  await expect(p.locator('input[aria-label="Invitation link"]')).toHaveCount(0);
});

test("invitations can be cancelled, and the cancel says so", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `cancel-${id}`;
  const owner = await signUpAndConfirm(browser, baseURL!, "Olive Owner", `cancel-owner${id}@example.com`);
  await createOrg(owner, "Cancel Co", slug);
  await inviteLink(owner, slug, `cancelled${id}@example.com`);
  await owner.goto(`/w/${slug}`);
  await shows(owner, `text=cancelled${id}@example.com`);
  await owner.getByRole("button", { name: "Cancel" }).click();
  await hidden(owner, `text=cancelled${id}@example.com`);
});

test("delete my account: a member leaves cleanly; a sole owner must hand over first", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `leaving-${id}`;
  const ownerEmail = `leave-owner${id}@example.com`;
  const memberEmail = `leave-member${id}@example.com`;
  const owner = await signUpAndConfirm(browser, baseURL!, "Olive Owner", ownerEmail);
  await createOrg(owner, "Leaving Co", slug);
  const link = await inviteLink(owner, slug, memberEmail);
  const member = await signUpAndConfirm(browser, baseURL!, "Mo Member", memberEmail, { canCreateCompany: false });
  await acceptInvite(member, link, slug);

  await test.step("the only owner of a company with others can't delete yet", async () => {
    await owner.click(`header >> text=${ownerEmail}`);
    await owner.waitForURL("**/account");
    await expect(owner.getByTestId("account-deletion-plan")).toContainText("Leaving Co: You are its only owner.");
    await expect(owner.getByRole("button", { name: "Delete my account for good" })).toBeDisabled();
  });

  await test.step("a member must type their own email, then the account is gone", async () => {
    await member.goto("/account");
    await expect(member.getByTestId("account-deletion-plan")).toContainText("Leaving Co: You leave it.");
    await member.fill("input[name=confirm]", "someone-else@example.com");
    await member.click('button:has-text("Delete my account for good")');
    await shows(member, "text=Type your own email address to confirm.");
    await member.fill("input[name=confirm]", memberEmail.toUpperCase());
    await member.click('button:has-text("Delete my account for good")');
    await member.waitForURL("**/login?deleted=1");
    await shows(member, "text=Your account has been deleted.");
    await member.goto(`/w/${slug}`);
    await member.waitForURL(/\/login/);
  });

  await test.step("the member can no longer sign in", async () => {
    await member.goto("/login");
    await member.fill("input[name=email]", memberEmail);
    await member.fill("input[name=password]", PASSWORD);
    await member.click("button[type=submit]");
    await shows(member, "text=That email and password don't match an account.");
  });

  await test.step("the owner's company keeps going without them", async () => {
    await owner.goto(`/w/${slug}`);
    await expect(owner.locator("main")).not.toContainText("Mo Member");
  });

  await test.step("now alone, the owner can delete their account and the company with it", async () => {
    await owner.goto("/account");
    await expect(owner.getByTestId("account-deletion-plan")).toContainText("Leaving Co: You are its only member");
    await owner.fill("input[name=confirm]", ownerEmail);
    await owner.click('button:has-text("Delete my account for good")');
    await owner.waitForURL("**/login?deleted=1");
    const client = new pg.Client({ connectionString: TEST_DB });
    await client.connect();
    const { rows } = await client.query("select 1 from public.organizations where slug = $1", [slug]);
    await client.end();
    expect(rows).toHaveLength(0);
  });
});

