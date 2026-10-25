import { expect, test } from "@playwright/test";
import pg from "pg";
import { createOrg, hidden, shows, signUpAndConfirm, stamp } from "./helpers";

/**
 * Adds a notification the way later stages will (inside the database), against
 * the local test database only. Returns the new ID, or null when the database
 * refused to address it to that person.
 */
async function notify(email: string, slug: string, title: string, key: string, issueId: string | null = null) {
  const client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select private.create_notification(o.id, u.id, $3, $4, $5, $6) as id
         from public.organizations o, auth.users u where o.slug = $1 and u.email = $2`,
      [slug, email, issueId ? "escalation" : "import_problem", title, key, issueId],
    );
    return rows[0]?.id as string | null;
  } finally {
    await client.end();
  }
}

// Notification rules are tested in supabase/tests/security_test.sql. Here: the
// bell and its count, the empty page, links, mark as read, and that another
// company's person sees none of it.

test("notifications: bell, list, mark as read, private to each person", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `note-${id}`;
  const slugB = `note-other-${id}`;
  const emailA = `note${id}@example.com`;
  const emailB = `note-other${id}@example.com`;
  const W = `/w/${slugA}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", emailA);
  await createOrg(p, "Note Co", slugA);

  await test.step("a new workspace has an empty bell and an empty page", async () => {
    await expect(p.getByTestId("notification-bell")).toHaveAttribute("aria-label", "Notifications, none unread");
    await hidden(p, '[data-testid="notification-count"]');
    await p.getByTestId("notification-bell").click();
    await p.waitForURL(`**${W}/notifications`);
    await shows(p, '[data-testid="notifications-empty"]');
    await hidden(p, '[data-testid="notification-mark-all-read"]');
  });

  const issueUrl = await test.step("an issue to link to", async () => {
    await p.goto(`${W}/issues/new`);
    await p.fill("input[name=customerName]", "Pat Example");
    await p.fill("input[name=subject]", "Cannot log in");
    await p.fill("textarea[name=message]", "Secret customer words.");
    await p.click("main button[type=submit]");
    await p.waitForURL(/created=1/);
    return new URL(p.url()).pathname;
  });
  const issueId = issueUrl.split("/").pop()!;

  const p2 = await signUpAndConfirm(browser, baseURL!, "Bea Other", emailB);
  await createOrg(p2, "Other Co", slugB);

  await test.step("notifications appear with an unread count", async () => {
    expect(await notify(emailA, slugA, "Issue escalated: no first response", `e2e:${id}:1`, issueId)).toBeTruthy();
    expect(await notify(emailA, slugA, "An import could not finish", `e2e:${id}:2`)).toBeTruthy();
    expect(await notify(emailA, slugA, "Repeat", `e2e:${id}:2`)).toBeNull();
    expect(await notify(emailB, slugA, "Not for the other company", `e2e:${id}:3`)).toBeNull();
    expect(await notify(emailB, slugB, "Other company's notice", `e2e:${id}:4`)).toBeTruthy();

    await p.goto(W);
    await expect(p.getByTestId("notification-count")).toHaveText("2");
    await expect(p.getByTestId("notification-bell")).toHaveAttribute("aria-label", "Notifications, 2 unread");
    await p.goto(`${W}/notifications`);
    await expect(p.getByTestId("notification-item")).toHaveCount(2);
    await expect(p.getByTestId("notification-list")).not.toContainText("Secret customer words.");
    await expect(p.getByTestId("notification-list")).not.toContainText("Other company's notice");
  });

  await test.step("links lead to the issue and to the import history", async () => {
    await p.click("text=Issue escalated: no first response");
    await p.waitForURL(`**${issueUrl}`);
    await p.goto(`${W}/notifications`);
    await expect(p.locator("a", { hasText: "An import could not finish" })).toHaveAttribute("href", `${W}/data-sources`);
  });

  await test.step("mark one as read, then all", async () => {
    const item = p.getByTestId("notification-item").filter({ hasText: "Issue escalated" });
    await item.getByTestId("notification-mark-read").click();
    await expect(item).toHaveAttribute("data-read", "true");
    await expect(p.getByTestId("notification-count")).toHaveText("1");
    await p.getByTestId("notification-mark-all-read").click();
    await shows(p, "text=Marked 1 notification as read.");
    await hidden(p, '[data-testid="notification-count"]');
    await p.reload();
    await expect(p.locator('[data-testid="notification-item"][data-read="false"]')).toHaveCount(0);
    await hidden(p, '[data-testid="notification-mark-read"]');
    await p.getByTestId("notification-mark-all-read").click();
    await shows(p, "text=Nothing was unread.");
  });

  await test.step("the other company's person sees only their own", async () => {
    await p2.goto(`/w/${slugB}/notifications`);
    await expect(p2.getByTestId("notification-count")).toHaveText("1");
    await expect(p2.getByTestId("notification-item")).toHaveCount(1);
    await expect(p2.getByTestId("notification-list")).toContainText("Other company's notice");
    await expect(p2.getByTestId("notification-list")).not.toContainText("Issue escalated");
    const response = await p2.goto(`${W}/notifications`);
    expect(response?.status()).toBe(404);
  });
});
