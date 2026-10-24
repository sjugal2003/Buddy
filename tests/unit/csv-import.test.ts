import { describe, expect, it } from "vitest";
import {
  buildImportRows,
  chunkRows,
  guessDateOrder,
  guessMapping,
  parseChannel,
  parseCsv,
  parseReceivedAt,
  rowProblem,
  type ImportRow,
} from "@/lib/csv-import";

const now = new Date("2026-10-24T12:00:00.000Z");

describe("reading CSV text", () => {
  it("handles quotes, commas and line breaks inside cells, CRLF and a byte-order mark", () => {
    const text = '﻿Name,Message\r\n"Lee, Sam","He said ""hi""\nthen left"\r\nAsha,Fine\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ["Name", "Message"],
      ["Lee, Sam", 'He said "hi"\nthen left'],
      ["Asha", "Fine"],
    ]);
  });

  it("uses semicolons or tabs when the heading row does", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\n\"1;2\",3")).toEqual([["a", "b"], ["1;2", "3"]]);
  });
});

describe("guessing the columns", () => {
  it("matches common headings and uses each column once", () => {
    expect(guessMapping(["Ticket ID", "Customer Name", "E-mail", "Channel", "Subject", "Body", "Created At"])).toEqual({
      recordId: 0,
      customerName: 1,
      customerEmail: 2,
      channel: 3,
      subject: 4,
      message: 5,
      receivedAt: 6,
    });
  });

  it("leaves a field empty when no heading fits", () => {
    expect(guessMapping(["Name", "Message", "Date"])).toMatchObject({
      recordId: null,
      customerEmail: null,
      subject: null,
      customerName: 0,
      message: 1,
      receivedAt: 2,
    });
  });
});

describe("channels", () => {
  it("understands common names and keeps unknown ones so they are rejected", () => {
    expect(parseChannel("E-mail", "survey")).toBe("email");
    expect(parseChannel("Live Chat", "email")).toBe("live_chat");
    expect(parseChannel("Twitter", "email")).toBe("social");
    expect(parseChannel("", "survey")).toBe("survey");
    expect(parseChannel("Fax", "email")).toBe("Fax");
  });
});

describe("received times", () => {
  it("reads times without a zone as the company's local time", () => {
    // 14:30 in Kolkata (UTC+5:30) is 09:00 UTC.
    expect(parseReceivedAt("2026-10-20 14:30", "ymd", "Asia/Kolkata")).toBe("2026-10-20T09:00:00.000Z");
    expect(parseReceivedAt("20/10/2026 14:30", "dmy", "Asia/Kolkata")).toBe("2026-10-20T09:00:00.000Z");
    expect(parseReceivedAt("10/20/2026 2:30 PM", "mdy", "Asia/Kolkata")).toBe("2026-10-20T09:00:00.000Z");
    expect(parseReceivedAt("2026-10-20", "ymd", "UTC")).toBe("2026-10-20T00:00:00.000Z");
  });

  it("keeps an explicit time zone", () => {
    expect(parseReceivedAt("2026-10-20T14:30:00Z", "dmy", "Asia/Kolkata")).toBe("2026-10-20T14:30:00.000Z");
    expect(parseReceivedAt("2026-10-20T14:30:00+0530", "dmy", "UTC")).toBe("2026-10-20T09:00:00.000Z");
  });

  it("refuses dates that do not exist or cannot be read", () => {
    expect(parseReceivedAt("31/02/2026", "dmy", "UTC")).toBeNull();
    expect(parseReceivedAt("13/13/2026", "dmy", "UTC")).toBeNull();
    expect(parseReceivedAt("yesterday", "dmy", "UTC")).toBeNull();
    expect(parseReceivedAt("10/20/2026", "ymd", "UTC")).toBeNull();
  });

  it("guesses the date order from the values", () => {
    expect(guessDateOrder(["20/10/2026", "01/02/2026"])).toBe("dmy");
    expect(guessDateOrder(["10/20/2026", "01/02/2026"])).toBe("mdy");
    expect(guessDateOrder(["2026-10-20"])).toBe("ymd");
    // Cannot tell: day first, which the person can change.
    expect(guessDateOrder(["01/02/2026"])).toBe("dmy");
  });
});

describe("building rows", () => {
  const headings = ["ID", "Name", "Email", "Message", "Received"];
  const mapping = guessMapping(headings);
  const options = { dateOrder: "ymd" as const, timeZone: "UTC", defaultChannel: "survey" as const };

  it("numbers rows as a spreadsheet does and fills subject and channel when the file has none", () => {
    const [row] = buildImportRows([["T-1", " Asha ", "Asha@Example.com", "My order never arrived. Please help.", "2026-10-20 09:00"]], mapping, options);
    expect(row).toEqual({
      row: 2,
      record_id: "T-1",
      customer_name: "Asha",
      customer_email: "Asha@Example.com",
      channel: "survey",
      subject: "My order never arrived. Please help.",
      message: "My order never arrived. Please help.",
      received_at: "2026-10-20T09:00:00.000Z",
    });
    expect(rowProblem(row, now)).toBeNull();
  });

  it("gives the same reasons as the database, in the same order", () => {
    const rows = buildImportRows(
      [
        ["1", "A", "", "Hi", "not a date"],
        ["2", "A", "", "", "2026-10-20"],
        ["3", "", "", "Hi", "2026-10-20"],
        ["4", "A", "bad-email", "Hi", "2026-10-20"],
        ["5", "A", "", "Hi", ""],
        ["6", "A", "", "Hi", "2027-01-01"],
        ["7", "A", "", "x".repeat(10_050), "2026-10-20"],
      ],
      mapping,
      options,
    );
    expect(rows.map((r) => rowProblem(r, now))).toEqual([
      "The received time is not a date.",
      "The message is empty.",
      "The customer name is empty.",
      "The email address is not valid.",
      "The received time is missing.",
      "The received time is in the future.",
      "The message is longer than 10,000 characters.",
    ]);
    // Over-long values are cut to one character over the limit, so the database still rejects them.
    expect(rows[6].message).toHaveLength(10_001);
  });

  it("rejects a channel Buddy does not know", () => {
    const withChannel = guessMapping(["Name", "Message", "Received", "Channel"]);
    const [row] = buildImportRows([["A", "Hi", "2026-10-20", "Fax"]], withChannel, options);
    expect(rowProblem(row, now)).toBe("The channel is not one Buddy knows.");
  });
});

describe("sending in pieces", () => {
  const row = (i: number, message = "Hi"): ImportRow => ({
    row: i + 2,
    record_id: "",
    customer_name: "A",
    customer_email: "",
    channel: "email",
    subject: "S",
    message,
    received_at: "2026-10-20T00:00:00.000Z",
  });

  it("sends at most 500 rows per request", () => {
    const chunks = chunkRows(Array.from({ length: 1201 }, (_, i) => row(i)));
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 201]);
  });

  it("keeps each request well under 1 MB", () => {
    const chunks = chunkRows(Array.from({ length: 200 }, (_, i) => row(i, "x".repeat(10_000))));
    for (const chunk of chunks) expect(new TextEncoder().encode(JSON.stringify(chunk)).length).toBeLessThan(800_000);
    expect(chunks.flat()).toHaveLength(200);
  });
});
