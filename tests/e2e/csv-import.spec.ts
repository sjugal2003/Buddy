import { expect, test, type Page } from "@playwright/test";
import { acceptInvite, createOrg, inviteLink, signUpAndConfirm, stamp } from "./helpers";

// CSV import on the Data sources page: guessed columns, preview with problem
// rows, open vs past conversations, results from the database, repeats
// skipped, members kept out, and other companies see nothing.

const openCsv = [
  "Ticket ID,Customer Name,Email,Channel,Subject,Message,Created At",
  'T-1,Asha Test,Asha@Example.com,E-mail,Refund missing,"I was charged twice, please refund.",2026-10-20 09:00',
  "T-2,Ben Test,,Live chat,App crashes,The app closes when I log in.,2026-10-21 10:30",
  "T-3,,,Email,No name,Nobody signed this.,2026-10-21 11:00",
  "T-4,Cara Test,not-an-email,Email,Bad email,Hello.,2026-10-21 12:00",
  "T-5,Dev Test,,Fax,Odd channel,Sent by fax.,2026-10-21 13:00",
  "T-1,Asha Test,,Email,Refund missing,Same ticket again.,2026-10-20 09:00",
].join("\r\n");

const historyCsv = ["Name,Message,Date", "Old Customer,Thanks for fixing my router.,20/09/2026 16:45"].join("\n");

async function chooseFile(page: Page, name: string, content: string) {
  await page.getByTestId("csv-file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(content) });
}

test("CSV import: preview, open or past, results, repeats skipped, members and other companies kept out", async ({
  browser,
  baseURL,
}) => {
  const id = stamp();
  const slugA = `csv-${id}`;
  const slugB = `csv-other-${id}`;
  const W = `/w/${slugA}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Alice Owner", `csv${id}@example.com`);
  await createOrg(p, "CSV Co", slugA);

  await test.step("a file that is not a table is refused before anything is saved", async () => {
    await p.goto(`${W}/data-sources`);
    await chooseFile(p, "empty.csv", "Name,Message\n");
    await expect(p.locator("main").getByRole("alert")).toContainText("no rows under the heading row");
  });

  await test.step("columns are guessed and the preview flags problem rows", async () => {
    await chooseFile(p, "tickets.csv", openCsv);
    await expect(p.getByTestId("map-recordId").locator("option:checked")).toHaveText("Ticket ID");
    await expect(p.getByTestId("map-message").locator("option:checked")).toHaveText("Message");
    await expect(p.getByTestId("map-receivedAt").locator("option:checked")).toHaveText("Created At");
    await expect(p.getByTestId("date-order")).toHaveValue("ymd");
    await expect(p.getByTestId("preview-row")).toHaveCount(6);
    await expect(p.getByTestId("preview-summary")).toContainText("3 of 6 rows look ready. 3 will be rejected");
    const table = p.getByTestId("preview-table");
    await expect(table).toContainText("The customer name is empty.");
    await expect(table).toContainText("The email address is not valid.");
    await expect(table).toContainText("The channel is not one Buddy knows.");
    // Nothing is saved until a kind is chosen and Import is pressed.
    await expect(p.getByRole("button", { name: /^Import \d+ rows$/ })).toBeDisabled();
    await expect(p.getByTestId("imports-empty")).toBeVisible();
  });

  await test.step("importing as open issues reports what the database did", async () => {
    await p.getByLabel(/Open issues/).check();
    await p.getByRole("button", { name: "Import 3 rows" }).click();
    await expect(p.getByTestId("import-result")).toContainText("Import finished.");
    // Row 7 repeats ticket T-1 from row 2, so it is skipped.
    await expect(p.getByTestId("result-imported")).toHaveText("2");
    await expect(p.getByTestId("result-duplicate")).toHaveText("1");
    await expect(p.getByTestId("result-rejected")).toHaveText("3");
    await expect(p.getByTestId("import-result")).toContainText("Row 4: The customer name is empty.");
    const history = p.getByTestId("import-row");
    await expect(history).toHaveCount(1);
    await expect(history).toContainText("tickets.csv");
    await expect(history).toContainText("Finished");
  });

  await test.step("imported issues are open, with email, channel and source", async () => {
    await p.goto(`${W}/issues?q=Refund`);
    await expect(p.getByTestId("issue-row")).toHaveCount(1);
    await p.getByTestId("issue-row").getByRole("link").click();
    await expect(p.getByTestId("customer-email")).toHaveText("asha@example.com");
    await expect(p.getByTestId("issue-origin")).toContainText("Spreadsheet (CSV) (ID T-1)");
    await expect(p.locator("main")).toContainText("I was charged twice, please refund.");
    await expect(p.locator("select[name=status]")).toHaveValue("new");
  });

  await test.step("importing the same file again skips every saved row", async () => {
    await p.goto(`${W}/data-sources`);
    await chooseFile(p, "tickets.csv", openCsv);
    await p.getByLabel(/Open issues/).check();
    await p.getByRole("button", { name: "Import 3 rows" }).click();
    await expect(p.getByTestId("result-imported")).toHaveText("0");
    await expect(p.getByTestId("result-duplicate")).toHaveText("3");
    await expect(p.getByTestId("import-row")).toHaveCount(2);
  });

  await test.step("past conversations are saved as resolved, with day-first dates", async () => {
    await p.getByRole("button", { name: "Import another file" }).click();
    await chooseFile(p, "history.csv", historyCsv);
    await expect(p.getByTestId("date-order")).toHaveValue("dmy");
    await expect(p.getByTestId("map-subject").locator("option:checked")).toHaveText("(none)");
    await p.getByTestId("default-channel").selectOption("phone_transcript");
    await p.getByLabel(/Past conversations, already resolved/).check();
    await p.getByRole("button", { name: "Import 1 rows" }).click();
    await expect(p.getByTestId("result-imported")).toHaveText("1");
    await p.goto(`${W}/issues?status=resolved`);
    await expect(p.getByTestId("issue-row")).toHaveCount(1);
    await expect(p.getByTestId("issue-row")).toContainText("Thanks for fixing my router.");
    // Only the two open imports count as open on the home page.
    await p.goto(W);
    await expect(p.getByTestId("open-issue-count")).toHaveText("2 open issues");
  });

  await test.step("a member sees the history but cannot import", async () => {
    const emailM = `csvmember${id}@example.com`;
    const link = await inviteLink(p, slugA, emailM);
    const M = await signUpAndConfirm(browser, baseURL!, "Mia Member", emailM);
    await acceptInvite(M, link, slugA);
    await M.goto(`${W}/data-sources`);
    await expect(M.getByTestId("import-row")).toHaveCount(3);
    await expect(M.getByTestId("import-not-allowed")).toBeVisible();
    await expect(M.getByTestId("csv-file")).toHaveCount(0);
  });

  await test.step("another company sees none of it", async () => {
    const B = await signUpAndConfirm(browser, baseURL!, "Bob Other", `csvother${id}@example.com`);
    await createOrg(B, "Other CSV Co", slugB);
    await B.goto(`/w/${slugB}/data-sources`);
    await expect(B.getByTestId("imports-empty")).toBeVisible();
    await B.goto(`/w/${slugB}/issues?q=Refund`);
    await expect(B.getByTestId("issue-row")).toHaveCount(0);
    expect((await B.goto(`${W}/data-sources`))?.status()).toBe(404);
    // The same file in company B imports fresh: IDs are per company.
    await B.goto(`/w/${slugB}/data-sources`);
    await chooseFile(B, "tickets.csv", openCsv);
    await B.getByLabel(/Open issues/).check();
    await B.getByRole("button", { name: "Import 3 rows" }).click();
    await expect(B.getByTestId("result-imported")).toHaveText("2");
  });
});

test("CSV import: a file larger than one piece is sent in several and every row is counted", async ({ browser, baseURL }) => {
  const id = stamp();
  const slug = `csv-big-${id}`;
  const p = await signUpAndConfirm(browser, baseURL!, "Big Owner", `csvbig${id}@example.com`);
  await createOrg(p, "Big CSV Co", slug);
  const lines = ["ID,Name,Message,Received"];
  for (let i = 1; i <= 1201; i++) lines.push(`B-${i},Customer ${i},Message number ${i},2026-10-01 08:00`);
  await p.goto(`/w/${slug}/data-sources`);
  await chooseFile(p, "big.csv", lines.join("\n"));
  await expect(p.getByTestId("preview-summary")).toContainText("1,201 of 1,201 rows look ready.");
  await p.getByLabel(/Past conversations, already resolved/).check();
  await p.getByRole("button", { name: "Import 1,201 rows" }).click();
  await expect(p.getByTestId("result-imported")).toHaveText("1,201", { timeout: 60_000 });
  await expect(p.getByTestId("import-row")).toContainText("1201");
});
