import { expect, type Browser, type Page } from "@playwright/test";
import pg from "pg";

/** The LOCAL test database (never the hosted project). */
export const TEST_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** The test server's AI result key: a made-up value, used only with the local database. */
export const TEST_AI_RESULT_KEY = "e2e-test-ai-result-key-not-a-real-secret";

export const PASSWORD = "correct-horse-9";

/** A short unique suffix, so each run uses fresh emails and web addresses. */
export const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/**
 * The confirmation link from the local email catcher. Buddy's email template
 * links to the site address in supabase/config.toml (port 3000), so that part
 * is pointed at the test server instead.
 */
async function confirmLink(email: string, baseURL: string) {
  const mail = process.env.E2E_MAIL_URL;
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${mail}/api/v1/search?query=to:${encodeURIComponent(email)}`)).json();
    if (list.messages?.length) {
      const message = await (await fetch(`${mail}/api/v1/message/${list.messages[0].ID}`)).json();
      const link = new URL((message.HTML as string).match(/href="([^"]+)"/)![1].replace(/&amp;/g, "&"));
      return link.origin === "http://localhost:3000" ? new URL(link.pathname + link.search, baseURL).toString() : link.toString();
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No confirmation email arrived for ${email}`);
}

/**
 * Puts an email on Buddy's list of people who may create a company (creating
 * a company is invite-only), directly in the local test database.
 */
export async function allowCompanyCreation(email: string) {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    await client.query("insert into private.company_creators (email) values (lower($1)) on conflict do nothing", [email]);
  } finally {
    await client.end();
  }
}

/**
 * Signs up in a fresh browser window and confirms the email. Ends on
 * /onboarding. Unless `canCreateCompany` is false, the email is first put on
 * the list of people who may create a company.
 */
export async function signUpAndConfirm(
  browser: Browser,
  baseURL: string,
  name: string,
  email: string,
  { canCreateCompany = true } = {},
) {
  if (canCreateCompany) await allowCompanyCreation(email);
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto("/signup");
  await page.fill("input[name=fullName]", name);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL("**/check-email");
  await page.goto(await confirmLink(email, baseURL));
  await page.waitForURL("**/onboarding");
  return page;
}

export async function createOrg(page: Page, name: string, slug: string) {
  await page.fill("input[name=name]", name);
  await page.fill("input[name=slug]", slug);
  await page.click("button[type=submit]");
  await page.waitForURL(`**/w/${slug}`);
}

/** Creates an invite link as the signed-in owner/admin of `slug`. */
export async function inviteLink(page: Page, slug: string, email: string) {
  await page.goto(`/w/${slug}`);
  await page.fill("input[name=email]", email);
  await page.click('button:has-text("Create invite link")');
  const field = page.locator('input[aria-label="Invitation link"]');
  await expect(field).toBeVisible();
  return field.inputValue();
}

export async function acceptInvite(page: Page, link: string, slug: string) {
  await page.goto(link);
  await page.click('button:has-text("Accept invitation")');
  await page.waitForURL(`**/w/${slug}`);
}

/** Passes when the element appears (waits up to 10 seconds). */
export const shows = (page: Page, selector: string) => expect(page.locator(selector).first()).toBeVisible();

/** Passes when nothing matching is on screen. */
export const hidden = (page: Page, selector: string) => expect(page.locator(selector)).toHaveCount(0);
