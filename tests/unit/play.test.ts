import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GOOGLE_TOKEN_URL,
  PLAY_SCOPE,
  jwtClaims,
  parseServiceAccount,
  playModeFrom,
  reviewToRow,
  reviewsToRows,
  type PlayReview,
} from "@/lib/play/review";

// Made-up key and reviews only.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const keyFile = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "service_account",
    project_id: "made-up",
    private_key_id: "abc",
    private_key: pem,
    client_email: "Buddy-Reader@made-up.iam.gserviceaccount.com",
    token_uri: "https://evil.example.com/token",
    ...extra,
  });

const review = (id: string, text: string | undefined, seconds: number | undefined, extra: Partial<PlayReview> = {}): PlayReview => ({
  reviewId: id,
  authorName: "Asha Verma",
  comments: [{ userComment: { text, starRating: 2, lastModified: seconds === undefined ? undefined : { seconds: String(seconds), nanos: 500_000_000 } } }],
  ...extra,
});

describe("Google Play mode", () => {
  it("uses the pretend Google Play only on this computer", () => {
    expect(playModeFrom({ BUDDY_PLAY_MODE: "fake" }, true, false)).toEqual({ mode: "fake", ignoredFake: false });
    expect(playModeFrom({ BUDDY_PLAY_MODE: "fake" }, false, true)).toEqual({ mode: "off", ignoredFake: true });
  });

  it("stays off unless real use is switched on and the key is set", () => {
    expect(playModeFrom({}, true, true).mode).toBe("off");
    expect(playModeFrom({ BUDDY_PLAY_REAL: "yes" }, false, true).mode).toBe("off");
    expect(playModeFrom({ BUDDY_PLAY_REAL: "on" }, false, false).mode).toBe("off");
    expect(playModeFrom({ BUDDY_PLAY_REAL: "on" }, false, true).mode).toBe("real");
  });
});

describe("service account keys", () => {
  it("keeps only the account address and private key", () => {
    const parsed = parseServiceAccount(keyFile());
    expect(parsed).toEqual({ clientEmail: "buddy-reader@made-up.iam.gserviceaccount.com", privateKey: pem });
  });

  it("refuses anything that isn't a service account key, without repeating it", () => {
    for (const bad of ["", "not json", "[]", keyFile({ type: "authorized_user" }), keyFile({ private_key: 42 }), "x".repeat(20_001)]) {
      const parsed = parseServiceAccount(bad);
      expect("error" in parsed).toBe(true);
    }
    const wrongEmail = parseServiceAccount(keyFile({ client_email: "someone@gmail.com" }));
    expect(wrongEmail).toMatchObject({ error: expect.stringContaining("service account") });
    expect(JSON.stringify(wrongEmail)).not.toContain("someone@gmail.com");
    expect(parseServiceAccount(keyFile({ private_key: "not a key" }))).toMatchObject({ error: expect.stringContaining("private key") });
  });

  it("signs in at Google's own address, never the one in the file, for an hour, read-only scope", () => {
    expect(jwtClaims("a@b.iam.gserviceaccount.com", 1000)).toEqual({
      iss: "a@b.iam.gserviceaccount.com",
      scope: PLAY_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: 1000,
      exp: 4600,
    });
    expect(GOOGLE_TOKEN_URL).toBe("https://oauth2.googleapis.com/token");
  });
});

describe("reviews as issues", () => {
  const t = Date.UTC(2026, 10, 3, 9, 30) / 1000;

  it("turns a review into an App review issue, title first", () => {
    expect(reviewToRow(review("gp:1", "Payment failed\tI was charged twice.", t), 1)).toEqual({
      row: 1,
      customer_name: "Asha Verma",
      channel: "app_review",
      subject: "★★ review: Payment failed",
      message: "Payment failed\n\nI was charged twice.",
      received_at: "2026-11-03T09:30:00.500Z",
      record_id: "gp:1",
    });
  });

  it("handles missing names and stars, and long text", () => {
    const long = `${"word ".repeat(30)}end`;
    const row = reviewToRow({ reviewId: "gp:2", comments: [{ userComment: { text: long, lastModified: { seconds: t } } }] }, 3)!;
    expect(row.customer_name).toBe("Google Play user");
    expect(row.subject.startsWith("Review: word")).toBe(true);
    expect(row.subject.endsWith("…")).toBe(true);
    expect(row.subject.length).toBeLessThanOrEqual(70);
    const huge = reviewToRow(review("gp:3", "x".repeat(12_000), t, { authorName: "n".repeat(200) }), 1)!;
    expect(huge.message.length).toBe(10_000);
    expect(huge.customer_name.length).toBe(120);
  });

  it("skips reviews with no ID, text or time, and saves the rest oldest first", () => {
    expect(reviewToRow(review("", "Text", t), 1)).toBeNull();
    expect(reviewToRow(review("gp:4", "   ", t), 1)).toBeNull();
    expect(reviewToRow(review("gp:5", "Text", undefined), 1)).toBeNull();
    const { rows, skipped } = reviewsToRows([
      review("new", "Newest", t + 60),
      review("none", undefined, t),
      review("old", "Oldest", t - 60),
      { reviewId: "empty", comments: [] },
    ]);
    expect(rows.map((r) => [r.record_id, r.row])).toEqual([
      ["old", 1],
      ["new", 2],
    ]);
    expect(skipped).toBe(2);
  });
});
