import { expect, test } from "@playwright/test";
import pg from "pg";
import { createOrg, PASSWORD, shows, signUpAndConfirm, stamp, TEST_DB } from "./helpers";

// Phase 7 stage 37: Forgot password, and limits on repeated actions (rules in
// supabase/tests/security_test.sql).

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
