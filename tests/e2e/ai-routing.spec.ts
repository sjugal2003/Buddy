import { expect, test } from "@playwright/test";
import { createOrg, shows, signUpAndConfirm, stamp } from "./helpers";

// Uses the free test analyser (BUDDY_AI_MODE=fake): "urgent" in a message
// makes it critical, so a rule on "urgency is Critical" matches.

test("AI in the inbox and routing: rules use AI values, and automatic routing is opt-in", async ({ browser, baseURL }) => {
  const id = stamp();
  const slugA = `airoute-${id}`;
  const slugB = `airoute-other-${id}`;
  const W = `/w/${slugA}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `airoute${id}@example.com`);
  await createOrg(p, "Route Co", slugA);

  await test.step("the owner adds a team, switches AI on and adds a rule on urgency", async () => {
    await p.goto(`${W}/settings`);
    const team = p.locator('form:has(button:has-text("Add team"))');
    await team.locator("input[name=name]").fill("Escalations");
    await team.locator('button:has-text("Add team")').click();
    await shows(p, 'text=Team "Escalations" added.');
    await expect(p.getByTestId("ai-auto-route")).toContainText("Off");
    await p.check("input[name=enabled]");
    await p.click('button:has-text("Save AI settings")');
    await shows(p, "text=AI analysis switched on.");

    await p.goto(`${W}/routing`);
    const editor = p.locator('form:has(button:has-text("Add rule"))');
    await editor.locator("input[name=name]").fill("Critical to Escalations");
    await editor.locator("select[name=teamId]").selectOption({ label: "Escalations" });
    await editor.locator('select[aria-label="Condition 1 field"]').selectOption("urgency");
    await editor.locator('select[aria-label="Condition 1 value"]').selectOption("critical");
    await editor.locator('button:has-text("Add rule")').click();
    await shows(p, 'text=Rule "Critical to Escalations" added.');
  });

  const newIssue = async (subject: string) => {
    await p.goto(`${W}/issues/new`);
    await p.fill("input[name=customerName]", "Dana Customer");
    await p.fill("input[name=subject]", subject);
    await p.fill("textarea[name=message]", "Our service is down. This is urgent.");
    await p.click("main button[type=submit]");
    await p.waitForURL(/created=1/);
    await expect(p.getByTestId("ai-panel")).toContainText("AI suggested");
  };

  await test.step("with automatic routing off, the rule only suggests the team", async () => {
    await newIssue("Service down");
    await shows(p, "text=Accepted AI urgency: Medium → Critical");
    await shows(p, 'main p:has-text("Critical to Escalations"):has-text("suggests Escalations")');
    await expect(p.locator("select[name=teamId]")).toHaveValue("");
  });

  await test.step("the inbox marks AI values and shows the AI summary", async () => {
    await p.goto(`${W}/issues`);
    const row = p.locator("main li", { hasText: "Service down" });
    await expect(row).toContainText("AI suggested");
    await expect(row).toContainText("Test analyser: Service down");
  });

  await test.step("with automatic routing on, a new issue goes straight to the team", async () => {
    await p.goto(`${W}/settings`);
    await p.check("input[name=autoRoute]");
    await p.click('button:has-text("Save AI settings")');
    await shows(p, "text=AI analysis switched on.");
    await expect(p.getByTestId("ai-auto-route")).toHaveText("On");

    await newIssue("Still down");
    await shows(p, 'text=Routing rule "Critical to Escalations" was applied.');
    await expect(p.locator("select[name=teamId]")).not.toHaveValue("");
    await shows(p, "text=Moved to team Escalations");
  });

  await test.step("another company's switch is untouched", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `airouteother${id}@example.com`);
    await createOrg(B, "Other Route Co", slugB);
    await B.goto(`/w/${slugB}/settings`);
    await expect(B.getByTestId("ai-auto-route")).toContainText("Off");
    expect((await B.goto(`${W}/issues`))?.status()).toBe(404);
  });
});
