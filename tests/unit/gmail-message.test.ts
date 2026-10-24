import { describe, expect, it } from "vitest";
import {
  FETCH_BATCH,
  type GmailMessage,
  fetchQuery,
  htmlToText,
  messageText,
  messageToRow,
  parseFrom,
  planFetch,
} from "@/lib/gmail/message";

const b64 = (text: string) => Buffer.from(text).toString("base64url");

describe("fetchQuery", () => {
  it("looks back 7 days the first time", () => {
    expect(fetchQuery(null)).toBe("in:inbox -from:me newer_than:7d");
  });

  it("continues after the last fetched email, in whole seconds", () => {
    expect(fetchQuery(new Date("2026-10-24T10:00:00.900Z"))).toBe(
      `in:inbox -from:me after:${Date.UTC(2026, 9, 24, 10) / 1000}`,
    );
  });
});

describe("planFetch", () => {
  it("takes the oldest emails first and says how many wait", () => {
    const newestFirst = Array.from({ length: 60 }, (_, i) => `m${60 - i}`);
    const plan = planFetch(newestFirst, false);
    expect(plan.batch).toHaveLength(FETCH_BATCH);
    expect(plan.batch[0]).toBe("m1");
    expect(plan.batch.at(-1)).toBe("m50");
    expect(plan.waiting).toBe(10);
    expect(plan.skippedOlder).toBe(false);
  });

  it("handles an empty inbox", () => {
    expect(planFetch([], false)).toEqual({ batch: [], waiting: 0, skippedOlder: false });
  });
});

describe("parseFrom", () => {
  it("reads a name and address", () => {
    expect(parseFrom('"Asha Rao" <Asha.Rao@Example.com>')).toEqual({ name: "Asha Rao", email: "asha.rao@example.com" });
    expect(parseFrom("Tom <tom@example.org>")).toEqual({ name: "Tom", email: "tom@example.org" });
  });

  it("reads a bare address", () => {
    expect(parseFrom("lena@example.net")).toEqual({ name: "", email: "lena@example.net" });
  });

  it("keeps no address when it is not valid", () => {
    expect(parseFrom("Mail Delivery System")).toEqual({ name: "Mail Delivery System", email: "" });
  });
});

describe("message text", () => {
  it("turns HTML into readable text", () => {
    expect(htmlToText("<style>p{}</style><p>Hi &amp; hello</p><p>Line&nbsp;two<br>three &#8364;</p>")).toBe(
      "Hi & hello\nLine two\nthree €\n",
    );
  });

  it("prefers the plain-text part over HTML and skips attachments", () => {
    const message: GmailMessage = {
      id: "m1",
      payload: {
        mimeType: "multipart/mixed",
        parts: [
          { mimeType: "text/plain", filename: "notes.txt", body: { data: b64("attachment") } },
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: b64("Plain\r\n\r\n\r\n\r\nversion  \r\n") } },
              { mimeType: "text/html", body: { data: b64("<p>HTML</p>") } },
            ],
          },
        ],
      },
    };
    expect(messageText(message)).toBe("Plain\n\nversion");
  });
});

describe("messageToRow", () => {
  it("makes an email row keyed by the Gmail message ID", () => {
    const row = messageToRow(
      {
        id: "18c2f0a1b2",
        internalDate: String(Date.UTC(2026, 9, 24, 9, 30)),
        payload: {
          mimeType: "text/html",
          headers: [
            { name: "from", value: "Priya <Priya@Example.com>" },
            { name: "SUBJECT", value: "  Refund\r\n  please " },
          ],
          body: { data: b64("<p>Charged twice</p>") },
        },
      },
      3,
    );
    expect(row).toEqual({
      row: 3,
      record_id: "18c2f0a1b2",
      customer_name: "Priya",
      customer_email: "priya@example.com",
      channel: "email",
      subject: "Refund please",
      message: "Charged twice",
      received_at: "2026-10-24T09:30:00.000Z",
    });
  });

  it("fills gaps instead of losing the email", () => {
    const row = messageToRow({ id: "m2", internalDate: "1700000000000", snippet: "Thanks &amp; bye", payload: { headers: [] } }, 1);
    expect(row.customer_name).toBe("Unknown sender");
    expect(row.subject).toBe("(no subject)");
    expect(row.message).toBe("Thanks & bye");
    const fromOnly = messageToRow({ id: "m3", payload: { headers: [{ name: "From", value: "sam@example.com" }] } }, 1);
    expect(fromOnly.customer_name).toBe("sam");
    expect(fromOnly.message).toBe("(no message text)");
    expect(fromOnly.received_at).toBeNull();
  });

  it("shortens long fields to what Buddy stores", () => {
    const row = messageToRow(
      {
        id: "m4",
        internalDate: "1700000000000",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: `${"N".repeat(200)} <n@example.com>` },
            { name: "Subject", value: "S".repeat(300) },
          ],
          body: { data: b64("M".repeat(12_000)) },
        },
      },
      1,
    );
    expect(row.customer_name).toHaveLength(120);
    expect(row.subject).toHaveLength(200);
    expect(row.message).toHaveLength(10_000);
    expect(row.message.endsWith("…")).toBe(true);
  });
});
