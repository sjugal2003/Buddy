import "server-only";
import { createPrivateKey, createSign, randomBytes } from "node:crypto";
import { runsOnThisComputer } from "@/lib/site-url";
import { parseTokenKey } from "@/lib/gmail/crypto";
import {
  GOOGLE_TOKEN_URL,
  MAX_PAGES,
  PACKAGE_NAME,
  PAGE_SIZE,
  jwtClaims,
  playModeFrom,
  type PlayMode,
  type PlayReview,
  type ServiceAccount,
} from "./review";

// Talking to Google Play, on the server only (improvement B, step 1). Buddy
// signs in as the company's own service account and only lists reviews.
// BUDDY_PLAY_MODE=fake swaps in a pretend Google Play with made-up reviews,
// like BUDDY_GMAIL_MODE=fake, and like it only works on this computer.

export function playMode(): PlayMode {
  const { mode, ignoredFake } = playModeFrom(
    { BUDDY_PLAY_MODE: process.env.BUDDY_PLAY_MODE, BUDDY_PLAY_REAL: process.env.BUDDY_PLAY_REAL },
    runsOnThisComputer(process.env),
    Boolean(parseTokenKey(process.env.GMAIL_TOKEN_KEY)),
  );
  if (ignoredFake) console.error("[play] BUDDY_PLAY_MODE=fake is for tests only and is ignored on a live server");
  return mode;
}

const shared = globalThis as typeof globalThis & { buddyPlayFakeKey?: Buffer; buddyPlayFakeReviews?: PlayReview[] };

/** The server-only key that encrypts saved service-account keys (the same one as Gmail's), or null. */
export function credentialKey(): Buffer | null {
  const key = parseTokenKey(process.env.GMAIL_TOKEN_KEY);
  if (key) return key;
  if (playMode() !== "fake") return null;
  shared.buddyPlayFakeKey ??= randomBytes(32);
  return shared.buddyPlayFakeKey;
}

/** Why talking to Google Play failed. */
export class PlayError extends Error {
  constructor(
    readonly kind: "key" | "access" | "app" | "google",
    message: string,
  ) {
    super(message);
  }
}

/** False when the private key can't be read, so it is refused before Google is asked. */
export function privateKeyWorks(privateKey: string): boolean {
  try {
    return createPrivateKey(privateKey).asymmetricKeyType === "rsa";
  } catch {
    return false;
  }
}

const TIMEOUT_MS = 15_000;

/** A short-lived access token for the service account. */
export async function accessToken(account: ServiceAccount): Promise<string> {
  if (playMode() === "fake") return "fake-access";
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify(jwtClaims(account.clientEmail, Math.floor(Date.now() / 1000)))).toString("base64url");
  let signature: string;
  try {
    signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.privateKey).toString("base64url");
  } catch {
    throw new PlayError("key", "The private key could not sign");
  }
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${header}.${claims}.${signature}`,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PlayError("google", "Google sign-in did not answer");
  }
  if (!response.ok) {
    // invalid_grant: the key was deleted, or the account disabled.
    throw new PlayError(response.status === 400 || response.status === 401 ? "key" : "google", `Google sign-in failed with status ${response.status}`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new PlayError("google", "Google returned no access token");
  return body.access_token;
}

// The pretend Google Play: four made-up reviews from the last few hours, the
// same for every test on this server. The fourth has no text, so it is skipped.
function fakeReviews(): PlayReview[] {
  if (!shared.buddyPlayFakeReviews) {
    const now = Math.floor(Date.now() / 1000);
    const at = (hoursAgo: number) => ({ seconds: String(now - hoursAgo * 3600), nanos: 0 });
    shared.buddyPlayFakeReviews = [
      {
        reviewId: "fake-review-1",
        authorName: "Asha Verma",
        comments: [{ userComment: { text: "Payment failed\tI was charged but my order never went through.", starRating: 1, lastModified: at(3) } }],
      },
      {
        reviewId: "fake-review-2",
        authorName: "Ben Carter",
        comments: [{ userComment: { text: "Nice app, but searching for products is really slow.", starRating: 4, lastModified: at(2) } }],
      },
      {
        reviewId: "fake-review-3",
        comments: [{ userComment: { text: "The app crashes every time I open my orders.", starRating: 2, lastModified: at(1) } }],
      },
      { reviewId: "fake-review-4", authorName: "No Text", comments: [] },
    ];
  }
  return shared.buddyPlayFakeReviews;
}

/** In the pretend Google Play, this app is one the service account was never given. */
export const FAKE_DENIED_PACKAGE = "com.example.denied";

async function playGet<T>(token: string, packageName: string, params: URLSearchParams): Promise<T> {
  if (!PACKAGE_NAME.test(packageName)) throw new PlayError("app", "Unexpected package name");
  let response: Response;
  try {
    response = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/reviews?${params}`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
  } catch {
    throw new PlayError("google", "Google Play did not answer");
  }
  if (response.status === 401) throw new PlayError("key", "Google Play refused the sign-in");
  if (response.status === 403) throw new PlayError("access", "Google Play refused access");
  if (response.status === 404) throw new PlayError("app", "Google Play has no such app");
  if (!response.ok) throw new PlayError("google", `Google Play request failed with status ${response.status}`);
  return (await response.json()) as T;
}

/**
 * The app's reviews with text from about the last week (Google keeps no more),
 * newest first, at most MAX_PAGES pages, and whether more were left.
 */
export async function listReviews(token: string, packageName: string, maxPages = MAX_PAGES): Promise<{ reviews: PlayReview[]; truncated: boolean }> {
  if (playMode() === "fake") {
    if (packageName === FAKE_DENIED_PACKAGE) throw new PlayError("access", "Google Play refused access");
    return { reviews: [...fakeReviews()].reverse(), truncated: false };
  }
  const reviews: PlayReview[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const params = new URLSearchParams({ maxResults: String(PAGE_SIZE) });
    if (pageToken) params.set("token", pageToken);
    const page = await playGet<{ reviews?: PlayReview[]; tokenPagination?: { nextPageToken?: string } }>(token, packageName, params);
    reviews.push(...(page.reviews ?? []));
    pageToken = page.tokenPagination?.nextPageToken;
    pages++;
  } while (pageToken && pages < maxPages);
  return { reviews, truncated: Boolean(pageToken) };
}
