import { expect, test } from "@playwright/test";
import { acceptInvite, createOrg, inviteLink, signUpAndConfirm, stamp } from "./helpers";

// Connecting and disconnecting a Gmail inbox. Uses the stand-in for Google
// (BUDDY_GMAIL_MODE=fake): no test ever contacts Google.

test("Gmail: owners connect and disconnect, members only see it, other companies see nothing", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `gmail-${id}`;
  const W = `/w/${slug}/data-sources`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `gmail${id}@example.com`);
  await createOrg(p, "Gmail Co", slug);

  await test.step("nothing is connected at first", async () => {
    await p.goto(W);
    await expect(p.getByTestId("gmail-not-connected")).toBeVisible();
    await expect(p.getByTestId("gmail-source-status")).toHaveText("Not connected.");
  });

  await test.step("a forged return from Google connects nothing", async () => {
    // No sign-in cookie at all.
    await p.goto("/api/gmail/callback?code=x&state=y");
    await expect(p).not.toHaveURL(/gmail=connected/);
    // Saying "connected" in the address bar does not make it so.
    await p.goto(`${W}?gmail=connected`);
    await expect(p.getByTestId("gmail-card")).toContainText("was not saved");
    await expect(p.getByTestId("gmail-not-connected")).toBeVisible();
  });

  await test.step("the owner connects the inbox", async () => {
    await p.goto(W);
    await p.getByTestId("gmail-connect").click();
    await p.waitForURL(/gmail=connected/);
    await expect(p.getByTestId("gmail-card")).toContainText("Gmail connected: test.inbox@example.com.");
    await expect(p.getByTestId("gmail-address")).toHaveText("test.inbox@example.com");
    await expect(p.getByTestId("gmail-card")).toContainText("by Alice Owner");
    await expect(p.getByTestId("gmail-source-status")).toHaveText("Connected: test.inbox@example.com (read-only)");
  });

  await test.step("a member sees the inbox but cannot connect or disconnect", async () => {
    const emailM = `gmailmember${id}@example.com`;
    const link = await inviteLink(p, slug, emailM);
    const M = await signUpAndConfirm(browser, baseURL!, "Mia Member", emailM);
    await acceptInvite(M, link, slug);
    await M.goto(W);
    await expect(M.getByTestId("gmail-address")).toHaveText("test.inbox@example.com");
    await expect(M.getByTestId("gmail-owner-only")).toBeVisible();
    await expect(M.getByTestId("gmail-disconnect")).toHaveCount(0);
    await M.goto(`/api/gmail/connect?workspace=${slug}`);
    await expect(M).toHaveURL(/gmail=not_owner/);
    await expect(M.getByTestId("gmail-card")).toContainText("Only owners can connect or disconnect the inbox.");
  });

  await test.step("another company sees no inbox and cannot reach this one", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `gmailother${id}@example.com`);
    await createOrg(B, "Other Gmail Co", `gmail-other-${id}`);
    await B.goto(`/w/gmail-other-${id}/data-sources`);
    await expect(B.getByTestId("gmail-not-connected")).toBeVisible();
    expect((await B.goto(W))?.status()).toBe(404);
    await B.goto(`/api/gmail/connect?workspace=${slug}`);
    await expect(B).not.toHaveURL(/gmail=/);
  });

  await test.step("the owner disconnects; issues are untouched and it can be connected again", async () => {
    await p.goto(W);
    // The confirm dialog is accepted by the sign-up helper's dialog handler.
    await p.getByTestId("gmail-disconnect").click();
    await expect(p.getByTestId("gmail-card")).toContainText("Gmail disconnected. Google has cancelled Buddy's access.");
    await expect(p.getByTestId("gmail-not-connected")).toBeVisible();
    await p.getByTestId("gmail-connect").click();
    await p.waitForURL(/gmail=connected/);
    await expect(p.getByTestId("gmail-address")).toHaveText("test.inbox@example.com");
  });
});
