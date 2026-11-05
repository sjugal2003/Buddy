import { generateKeyPairSync } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { acceptInvite, createOrg, inviteLink, signUpAndConfirm, stamp, TEST_DB } from "./helpers";

// Google Play reviews (improvement B, step 1) with the pretend Google Play
// (BUDDY_PLAY_MODE=fake), which holds four made-up reviews, one without text.
// The key below is made up here; no test ever contacts Google. Who may
// connect and fetch is checked in supabase/tests/security_test.sql.

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyFile = JSON.stringify({
  type: "service_account",
  project_id: "made-up",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  client_email: "buddy-reader@made-up.iam.gserviceaccount.com",
});

async function makeAdmin(slug: string, email: string) {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    await client.query(
      `update public.organization_members m set role = 'admin'
       from public.organizations o, auth.users u
       where o.id = m.organization_id and u.id = m.user_id and o.slug = $1 and u.email = $2`,
      [slug, email],
    );
  } finally {
    await client.end();
  }
}

test("Google Play: owner connects, reviews become issues once, others can't", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `play-${id}`;
  const W = `/w/${slug}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `play${id}@example.com`);
  await createOrg(p, "Play Co", slug);
  const form = p.getByTestId("play-connect-form");

  await test.step("a wrong key or an app the account can't reach is refused, and nothing is saved", async () => {
    await p.goto(`${W}/data-sources`);
    await expect(p.getByTestId("play-test-mode")).toBeVisible();
    await expect(p.getByTestId("play-source-status")).toHaveText("Not connected.");
    await form.locator("input[name=packageName]").fill("not a package");
    await form.locator("textarea[name=serviceAccountKey]").fill(keyFile);
    await p.getByTestId("play-connect").click();
    await expect(form).toContainText("Use the app's package name");
    await form.locator("input[name=packageName]").fill("com.example.shop");
    await form.locator("textarea[name=serviceAccountKey]").fill('{"type":"authorized_user"}');
    await p.getByTestId("play-connect").click();
    await expect(form).toContainText("That isn't a Google service account key.");
    await form.locator("input[name=packageName]").fill("com.example.denied");
    await form.locator("textarea[name=serviceAccountKey]").fill(keyFile);
    await p.getByTestId("play-connect").click();
    await expect(form).toContainText("Google Play refused access.");
    await expect(p.getByTestId("play-not-connected")).toBeVisible();
  });

  await test.step("the owner connects the app", async () => {
    await form.locator("input[name=packageName]").fill("com.example.shop");
    await form.locator("textarea[name=serviceAccountKey]").fill(keyFile);
    await p.getByTestId("play-connect").click();
    await p.waitForURL(/play=connected/);
    await expect(p.getByTestId("play-card")).toContainText("Google Play connected: com.example.shop.");
    await expect(p.getByTestId("play-package")).toHaveText("com.example.shop");
    await expect(p.getByTestId("play-card")).toContainText("buddy-reader@made-up.iam.gserviceaccount.com");
    await expect(p.getByTestId("play-last-fetched")).toHaveText("Never");
    // The key is never shown again.
    expect(await p.content()).not.toContain("BEGIN PRIVATE KEY");
  });

  await test.step("fetch: three reviews with text become App review issues", async () => {
    await p.getByTestId("play-fetch-button").click();
    await expect(p.getByTestId("play-fetch-result")).toContainText(
      "Google Play sent 4 reviews: 3 added as issues, 1 without text skipped.",
    );
    await expect(p.getByTestId("play-last-fetched")).not.toHaveText("Never");
    const history = p.getByTestId("import-row");
    await expect(history).toHaveCount(1);
    await expect(history).toContainText("Google Play reviews");
    await expect(history).toContainText("com.example.shop");
    await expect(history).toContainText("Finished");

    await p.goto(`${W}/issues`);
    await expect(p.getByTestId("issue-row")).toHaveCount(3);
    await p.goto(`${W}/issues?q=charged`);
    await p.getByTestId("issue-row").getByRole("link").click();
    await expect(p.locator("main")).toContainText("★ review: Payment failed");
    await expect(p.locator("main")).toContainText("Asha Verma");
    await expect(p.locator("main")).toContainText("I was charged but my order never went through.");
    await expect(p.getByTestId("issue-origin")).toContainText("Google Play review");
    await p.goto(`${W}/issues?q=crashes`);
    await expect(p.getByTestId("issue-row")).toContainText("Google Play user");
  });

  await test.step("fetching again adds nothing", async () => {
    await p.goto(`${W}/data-sources`);
    await p.getByTestId("play-fetch-button").click();
    await expect(p.getByTestId("play-fetch-result")).toContainText("0 added as issues, 3 already in Buddy, 1 without text skipped.");
    await p.goto(`${W}/issues`);
    await expect(p.getByTestId("issue-row")).toHaveCount(3);
  });

  await test.step("an admin can fetch but not disconnect; a member can only look", async () => {
    const emailA = `playadmin${id}@example.com`;
    const linkA = await inviteLink(p, slug, emailA);
    const A = await signUpAndConfirm(browser, baseURL!, "Adam Admin", emailA, { canCreateCompany: false });
    await acceptInvite(A, linkA, slug);
    await makeAdmin(slug, emailA);
    await A.goto(`${W}/data-sources`);
    await A.getByTestId("play-fetch-button").click();
    await expect(A.getByTestId("play-fetch-result")).toContainText("3 already in Buddy");
    await expect(A.getByTestId("play-owner-only")).toBeVisible();
    await expect(A.getByTestId("play-disconnect")).toHaveCount(0);

    const emailM = `playmember${id}@example.com`;
    const linkM = await inviteLink(p, slug, emailM);
    const M = await signUpAndConfirm(browser, baseURL!, "Mia Member", emailM, { canCreateCompany: false });
    await acceptInvite(M, linkM, slug);
    await M.goto(`${W}/data-sources`);
    await expect(M.getByTestId("play-package")).toHaveText("com.example.shop");
    await expect(M.getByTestId("play-fetch-not-allowed")).toBeVisible();
    await expect(M.getByTestId("play-fetch-button")).toHaveCount(0);
    await expect(M.getByTestId("play-connect-form")).toHaveCount(0);
  });

  await test.step("another company sees none of it", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `playother${id}@example.com`);
    await createOrg(B, "Other Play Co", `play-other-${id}`);
    await B.goto(`/w/play-other-${id}/data-sources`);
    await expect(B.getByTestId("play-not-connected")).toBeVisible();
    await expect(B.getByTestId("play-fetch-button")).toHaveCount(0);
    await expect(B.getByTestId("import-row")).toHaveCount(0);
    await B.goto(`/w/play-other-${id}/issues`);
    await expect(B.getByTestId("issue-row")).toHaveCount(0);
    const response = await B.goto(`${W}/data-sources`);
    expect(response?.status()).toBe(404);
  });

  await test.step("the owner disconnects; the issues stay", async () => {
    await p.goto(`${W}/data-sources`);
    // The confirm dialog is accepted by the sign-up helper's dialog handler.
    await p.getByTestId("play-disconnect").click();
    await p.waitForURL(/play=disconnected/);
    await expect(p.getByTestId("play-card")).toContainText("Google Play disconnected.");
    await expect(p.getByTestId("play-not-connected")).toBeVisible();
    await p.goto(`${W}/issues`);
    await expect(p.getByTestId("issue-row")).toHaveCount(3);
  });
});

// Merging before the database change is applied must not break the page: the
// Google Play card says it isn't available and everything else still works.
test("Data sources still loads when the Google Play tables are missing", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `play-missing-${id}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `playmissing${id}@example.com`);
  await createOrg(p, "Missing Co", slug);
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    await client.query("alter table public.source_connections rename to source_connections_hidden");
    await client.query("notify pgrst, 'reload schema'");
    await expect(async () => {
      await p.goto(`/w/${slug}/data-sources`);
      await expect(p.getByTestId("play-unavailable")).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await expect(p.getByTestId("play-source-status")).toHaveText("Not available yet.");
    await expect(p.getByTestId("play-connect-form")).toHaveCount(0);
    await expect(p.getByTestId("gmail-card")).toBeVisible();
    await expect(p.getByTestId("imports-empty")).toBeVisible();
  } finally {
    await client.query("alter table if exists public.source_connections_hidden rename to source_connections");
    await client.query("notify pgrst, 'reload schema'");
    await client.end();
  }
});
