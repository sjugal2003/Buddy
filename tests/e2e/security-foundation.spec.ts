import { expect, request, test } from "@playwright/test";
import pg from "pg";
import globalSetup from "./global-setup";
import { acceptInvite, createOrg, hidden, inviteLink, shows, signUpAndConfirm, stamp, TEST_DB } from "./helpers";

// Phase 7 stage 36: security headers, invite-only company creation, the AI
// limit for the whole app and the AI result key (rules in supabase/tests/security_test.sql).

test("every page sends the security headers", async ({ baseURL }) => {
  const visitor = await request.newContext({ baseURL });
  for (const path of ["/login", "/demo/brightline"]) {
    const response = await visitor.get(path);
    const headers = response.headers();
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"], path).toContain("object-src 'none'");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(headers["x-powered-by"], path).toBeUndefined();
  }
  await visitor.dispose();
});

test("creating a company is invite-only, and invited people still get in", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `invite-only-${id}`;
  const newcomerEmail = `newcomer${id}@example.com`;

  const newcomer = await test.step("someone not on the list signs up and is told they need an invitation", async () => {
    const page = await signUpAndConfirm(browser, baseURL!, "Nina Newcomer", newcomerEmail, { canCreateCompany: false });
    await expect(page.getByTestId("invite-only")).toContainText("Buddy is invite-only for now");
    await hidden(page, "input[name=slug]");
    return page;
  });

  const owner = await test.step("an owner on the list creates a company as before", async () => {
    const page = await signUpAndConfirm(browser, baseURL!, "Omar Owner", `invite-owner${id}@example.com`);
    await createOrg(page, "Invite Only Co", slug);
    return page;
  });

  await test.step("the invitation link uses Buddy's own address, and the newcomer gets in with it", async () => {
    const link = await inviteLink(owner, slug, newcomerEmail);
    expect(new URL(link).origin).toBe(new URL(baseURL!).origin);
    await acceptInvite(newcomer, link, slug);
    await shows(newcomer, 'h1:has-text("Invite Only Co")');
  });

  await test.step("joining a company does not let them create one", async () => {
    await newcomer.goto("/onboarding");
    await expect(newcomer.getByTestId("invite-only")).toBeVisible();
  });
});

/** Sets the AI limit for the whole app in the local test database; returns how many were used this month. */
async function setAppAiLimit(limit: number | "used") {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select count(*)::int as used from public.issue_analyses
       where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'`,
    );
    await client.query("update private.platform_settings set ai_monthly_cap = $1", [limit === "used" ? rows[0].used : limit]);
  } finally {
    await client.end();
  }
}

test("the AI limit for the whole app stops analyses even when the company has some left", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `app-limit-${id}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `app-limit${id}@example.com`);
  await createOrg(p, "App Limit Co", slug);
  await p.goto(`/w/${slug}/settings`);
  await p.check("input[name=enabled]");
  await p.click('button:has-text("Save AI settings")');
  await shows(p, "text=AI analysis switched on.");

  await setAppAiLimit("used");
  try {
    await p.goto(`/w/${slug}/issues/new`);
    await p.fill("input[name=customerName]", "Sam Limit");
    await p.fill("input[name=subject]", "Charged twice");
    await p.fill("textarea[name=message]", "I was charged twice. Please refund one.");
    await p.click("main button[type=submit]");
    await p.waitForURL(/created=1/);
    await shows(p, "text=Buddy has used all of this month's AI analyses");
    await hidden(p, "text=Analysed by AI");
  } finally {
    // Back to the local value from supabase/seed.sql, for the tests that follow.
    await setAppAiLimit(100000);
  }
});

test("AI results are refused when the server's key doesn't match the database", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `ai-key-${id}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `ai-key${id}@example.com`);
  await createOrg(p, "AI Key Co", slug);
  await p.goto(`/w/${slug}/settings`);
  await p.check("input[name=enabled]");
  await p.click('button:has-text("Save AI settings")');
  await shows(p, "text=AI analysis switched on.");

  // As if the database were set up with another server's key.
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  await client.query("update private.platform_settings set ai_result_key_hash = $1", ["0".repeat(64)]);
  await client.end();
  try {
    await p.goto(`/w/${slug}/issues/new`);
    await p.fill("input[name=customerName]", "Sam Key");
    await p.fill("input[name=subject]", "Charged twice");
    await p.fill("textarea[name=message]", "I was charged twice. Please refund one.");
    await p.click("main button[type=submit]");
    await p.waitForURL(/created=1/);
    await shows(p, "text=BUDDY_AI_RESULT_KEY does not match");
    await hidden(p, "text=Analysed by AI");
  } finally {
    // Back to the test server's key, for the tests that follow.
    await globalSetup();
  }
});
