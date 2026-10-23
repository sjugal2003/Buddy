import { expect, test } from "@playwright/test";
import { acceptInvite, createOrg, hidden, inviteLink, shows, signUpAndConfirm, stamp } from "./helpers";

test("sign-up, companies, invitations and roles", async ({ browser, baseURL, page }) => {
  const id = stamp();
  const slugA = `acme-${id}`;
  const slugC = `other-${id}`;
  const emailB = `member${id}@example.com`;

  await test.step("sign-up rejects a bad email and a short password", async () => {
    await page.goto("/signup");
    await page.fill("input[name=fullName]", "X");
    await page.fill("input[name=email]", "not-an-email");
    await page.fill("input[name=password]", "short");
    await page.click("button[type=submit]");
    await shows(page, "text=Enter a valid email address.");
    await shows(page, "text=Use at least 8 characters.");
  });

  await test.step("sign-in with a wrong password shows a plain error", async () => {
    await page.goto("/login");
    await page.fill("input[name=email]", "nobody@example.com");
    await page.fill("input[name=password]", "wrong-password");
    await page.click("button[type=submit]");
    await expect(page.locator("form p[role=alert]")).toContainText("don't match");
  });

  await test.step("sign-in ignores redirects to other sites", async () => {
    await page.goto("/login?next=//evil.example.com");
    await expect(page.locator("input[name=next]")).toHaveValue("/");
  });

  const A = await test.step("owner signs up and confirms email", () =>
    signUpAndConfirm(browser, baseURL!, "Alice Owner", `owner${id}@example.com`),
  );

  await test.step("owner creates a company and lands in it", async () => {
    await createOrg(A, "Acme Test", slugA);
    await shows(A, 'h1:has-text("Acme Test")');
    await shows(A, "text=Alice Owner");
  });

  await test.step("a taken or invalid web address is rejected with a clear message", async () => {
    await A.goto("/onboarding");
    await A.fill("input[name=name]", "Dup");
    await A.fill("input[name=slug]", slugA);
    await A.click("button[type=submit]");
    await shows(A, "text=already taken");
    await A.fill("input[name=slug]", "Bad Slug!");
    await A.click("button[type=submit]");
    await shows(A, "text=Use 3 to 40 lowercase");
  });

  const link = await test.step("owner creates an invite link, listed as open", async () => {
    const link = await inviteLink(A, slugA, emailB);
    expect(link).toContain("/invite?token=");
    await A.reload();
    await shows(A, `text=${emailB}`);
    return link;
  });

  await test.step("someone from another company cannot use the link or open Acme", async () => {
    const C = await signUpAndConfirm(browser, baseURL!, "Carl Other", `other${id}@example.com`);
    await createOrg(C, "Other Co", slugC);
    await C.goto(link);
    await C.click('button:has-text("Accept invitation")');
    await expect(C.locator("form p[role=alert]")).toContainText("different email");
    expect((await C.goto(`/w/${slugA}`))?.status()).toBe(404);
  });

  const B = await test.step("invited person joins as a member without the invite form", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bea Member", emailB);
    await acceptInvite(B, link, slugA);
    await shows(B, "text=You are a member of this workspace.");
    await hidden(B, "text=Invite a colleague");
    expect((await B.goto(`/w/${slugC}`))?.status()).toBe(404);
    return B;
  });

  await test.step("owner promotes the member to admin, who still cannot change the owner", async () => {
    await A.goto(`/w/${slugA}`);
    const row = A.locator("li", { hasText: "Bea Member" });
    await row.locator("select[name=role]").selectOption("admin");
    await row.locator('button:has-text("Save")').click();
    await shows(A, "text=Role updated.");
    await B.goto(`/w/${slugA}`);
    await shows(B, "text=Invite a colleague");
    await expect(B.locator("li", { hasText: "Alice Owner" }).locator("select")).toHaveCount(0);
  });

  await test.step("the last owner cannot leave", async () => {
    await A.locator("li", { hasText: "Alice Owner" }).locator('button:has-text("Leave")').click();
    await shows(A, "text=Make someone else an owner");
  });

  await test.step("after sign-out the workspace needs sign-in again", async () => {
    await A.click('button:has-text("Sign out")');
    await A.waitForURL("**/login");
    await A.goto(`/w/${slugA}`);
    expect(A.url()).toContain("/login?next=");
  });

  await test.step("all 8 demo pages load without signing in", async () => {
    for (const path of ["", "/inbox", "/intelligence", "/routing", "/data-sources", "/reports", "/automation", "/settings"]) {
      expect((await A.goto(`/demo/brightline${path}`))?.status(), `demo page ${path || "/"}`).toBe(200);
    }
  });
});
