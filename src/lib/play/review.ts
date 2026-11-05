// Pure helpers for Google Play reviews (improvement B, step 1), shared by the
// server code in ./index.ts and the unit tests. Nothing here talks to Google.

/** Google's own sign-in address. Buddy never uses an address taken from the key file. */
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Read-only use of the Play Developer API: Buddy only lists reviews. */
export const PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
/** Pages of 100 reviews read per fetch. Google allows 200 reads an hour per app. */
export const MAX_PAGES = 5;
export const PAGE_SIZE = 100;

export const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export type PlayMode = "fake" | "real" | "off";

/**
 * Whether Google Play can be used on this server, and how.
 * - BUDDY_PLAY_MODE=fake: the pretend Google Play, only on this computer.
 * - BUDDY_PLAY_REAL=on (and GMAIL_TOKEN_KEY): the real one. A real app brings
 *   real customer reviews, so it stays off until the owner approves real data.
 * - Otherwise off.
 */
export function playModeFrom(
  env: { BUDDY_PLAY_MODE?: string; BUDDY_PLAY_REAL?: string },
  onThisComputer: boolean,
  hasKey: boolean,
): { mode: PlayMode; ignoredFake: boolean } {
  if (env.BUDDY_PLAY_MODE === "fake") {
    return onThisComputer ? { mode: "fake", ignoredFake: false } : { mode: "off", ignoredFake: true };
  }
  if (env.BUDDY_PLAY_REAL?.trim() === "on" && hasKey) return { mode: "real", ignoredFake: false };
  return { mode: "off", ignoredFake: false };
}

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

/**
 * The two parts of a Google service-account key file that Buddy keeps, or a
 * message saying what is wrong. The rest of the file (project, key ID, token
 * address) is dropped. Never echoes any part of the file.
 */
export function parseServiceAccount(text: string): ServiceAccount | { error: string } {
  const invalid = { error: "That isn't a Google service account key. Paste the whole JSON file Google gave you." };
  if (!text.trim() || text.length > 20_000) return invalid;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return invalid;
  }
  if (!data || typeof data !== "object") return invalid;
  const { type, client_email: clientEmail, private_key: privateKey } = data as Record<string, unknown>;
  if (type !== "service_account" || typeof clientEmail !== "string" || typeof privateKey !== "string") return invalid;
  const email = clientEmail.trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(email)) {
    return { error: "The key's account address doesn't look like a Google service account (…@….iam.gserviceaccount.com)." };
  }
  if (!privateKey.includes("-----BEGIN PRIVATE KEY-----") || privateKey.length > 4000) {
    return { error: "The key file has no private key. Make a new JSON key for the service account and paste all of it." };
  }
  return { clientEmail: email, privateKey };
}

/** The claims Buddy signs to sign in as the service account, valid for an hour. */
export function jwtClaims(clientEmail: string, nowSeconds: number) {
  return { iss: clientEmail, scope: PLAY_SCOPE, aud: GOOGLE_TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 };
}

/** One review as Google's reviews.list returns it (only the fields Buddy uses). */
export interface PlayReview {
  reviewId?: string;
  authorName?: string;
  comments?: {
    userComment?: {
      text?: string;
      starRating?: number;
      lastModified?: { seconds?: string | number; nanos?: number };
    };
  }[];
}

/** The row import_issues expects, as for CSV rows and Gmail messages. */
export interface ReviewRow {
  row: number;
  customer_name: string;
  channel: "app_review";
  subject: string;
  message: string;
  received_at: string;
  record_id: string;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function firstWords(text: string, max = 60) {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** When the review was written or last changed, or null when Google sent no usable time. */
export function reviewTime(review: PlayReview): Date | null {
  const modified = review.comments?.[0]?.userComment?.lastModified;
  const seconds = Number(modified?.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const at = new Date(seconds * 1000 + Math.floor((modified?.nanos ?? 0) / 1e6));
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * A review as an issue row, or null when it has no ID, text or time (Google
 * only sends reviews with text, so this is rare). The title Google separates
 * with a tab becomes the first line. Only the review itself is used: never the
 * device, app version or reply.
 */
export function reviewToRow(review: PlayReview, row: number): ReviewRow | null {
  const id = review.reviewId?.trim();
  if (!id || id.length > 200) return null;
  const comment = review.comments?.[0]?.userComment;
  const raw = comment?.text?.trim();
  const at = reviewTime(review);
  if (!raw || !at) return null;

  const [title, ...rest] = raw.split("\t");
  const body = rest.join(" ").trim();
  const message = clip(body ? `${title.trim()}\n\n${body}` : title.trim(), 10_000);
  const stars = comment?.starRating;
  const prefix = Number.isInteger(stars) && stars! >= 1 && stars! <= 5 ? `${"★".repeat(stars!)} review` : "Review";
  const subject = clip(`${prefix}: ${firstWords(title.trim() || body)}`, 200);
  const name = review.authorName?.replace(/\s+/g, " ").trim();
  return {
    row,
    customer_name: name ? clip(name, 120) : "Google Play user",
    channel: "app_review",
    subject,
    message,
    received_at: at.toISOString(),
    record_id: id,
  };
}

/** Rows for the reviews worth saving, oldest first, and how many had nothing to save. */
export function reviewsToRows(reviews: PlayReview[]): { rows: ReviewRow[]; skipped: number } {
  const usable = reviews
    .map((review) => ({ review, at: reviewTime(review) }))
    .filter((x): x is { review: PlayReview; at: Date } => x.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const rows: ReviewRow[] = [];
  for (const { review } of usable) {
    const r = reviewToRow(review, rows.length + 1);
    if (r) rows.push(r);
  }
  return { rows, skipped: reviews.length - rows.length };
}
