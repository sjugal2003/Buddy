import { expect, test } from "@playwright/test";
import { acceptInvite, createOrg, hidden, inviteLink, shows, signUpAndConfirm, stamp } from "./helpers";

// What creates notifications (all rules are tested in supabase/tests/security_test.sql).
// Here, through the app: a critical issue, an escalation from Check now and a
// CSV import with a rejected row each reach the owner's bell; a member and
// another company get nothing.

const csv = ["Name,Message,Created At", "Good Customer,Hello there.,2026-10-20 09:00", ",Nobody signed this.,2026-10-20 10:00"].join("\n");

test("notification events: urgent issue, escalation, import problem", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `ev-${id}`;
  const slugB = `ev-other-${id}`;
  const W = `/w/${slugA}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `ev${id}@example.com`);
  await createOrg(p, "Event Co", slugA);
  const link = await inviteLink(p, slugA, `ev-member${id}@example.com`);
  const m = await signUpAndConfirm(browser, baseURL!, "Mel Member", `ev-member${id}@example.com`);
  await acceptInvite(m, link, slugA);

  const issueUrl = await test.step("a critical issue notifies the owner", async () => {
    await p.goto(`${W}/issues/new`);
    await p.fill("input[name=customerName]", "Private Person");
    await p.fill("input[name=subject]", "Everything is down");
    await p.fill("textarea[name=message]", "Private words from the customer.");
    await p.selectOption("select[name=urgency]", "critical");
    await p.click("main button[type=submit]");
    await p.waitForURL(/created=1/);
    const url = new URL(p.url()).pathname;
    await expect(p.getByTestId("notification-count")).toHaveText("1");
    await p.goto(`${W}/notifications`);
    const item = p.getByTestId("notification-item").filter({ hasText: /Critical issue: ISS-/ });
    await expect(item).toHaveCount(1);
    await expect(item.getByRole("link")).toHaveAttribute("href", url);
    await expect(p.getByTestId("notification-list")).not.toContainText("Private");
    return url;
  });

  await test.step("an escalation from Check now notifies the owner", async () => {
    await p.goto(`${W}/settings`);
    await p.check("input[name=urgentNoTeam]");
    await p.fill("input[name=urgentNoTeamHours]", "0");
    await p.click('button:has-text("Save escalation settings")');
    await shows(p, "text=Escalation settings saved.");
    await p.click('button:has-text("Check now")');
    await shows(p, "text=Checked 1 open issue: 1 new escalation.");
    await p.goto(`${W}/notifications`);
    await expect(p.getByTestId("notification-count")).toHaveText("2");
    const item = p.getByTestId("notification-item").filter({ hasText: "Escalated (level 2): urgent issue still has no team" });
    await expect(item.getByRole("link")).toHaveAttribute("href", issueUrl);
  });

  await test.step("a CSV import with a rejected row notifies the owner", async () => {
    await p.goto(`${W}/data-sources`);
    await p.getByTestId("csv-file").setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await p.getByLabel(/Open issues/).check();
    await p.getByRole("button", { name: /^Import \d+ rows?$/ }).click();
    await expect(p.getByTestId("result-rejected")).toHaveText("1");
    await p.goto(`${W}/notifications`);
    await expect(p.getByTestId("notification-count")).toHaveText("3");
    const item = p.getByTestId("notification-item").filter({ hasText: "CSV import finished, but 1 row could not be saved." });
    await expect(item.getByRole("link")).toHaveAttribute("href", `${W}/data-sources`);
  });

  await test.step("a member gets none of these", async () => {
    await m.goto(`${W}/notifications`);
    await hidden(m, '[data-testid="notification-count"]');
    await shows(m, '[data-testid="notifications-empty"]');
  });

  await test.step("another company gets none of these", async () => {
    const b = await signUpAndConfirm(browser, baseURL!, "Bea Other", `ev-other${id}@example.com`);
    await createOrg(b, "Other Co", slugB);
    await b.goto(`/w/${slugB}/notifications`);
    await hidden(b, '[data-testid="notification-count"]');
    await shows(b, '[data-testid="notifications-empty"]');
    expect((await b.goto(`${W}/notifications`))?.status()).toBe(404);
  });
});
