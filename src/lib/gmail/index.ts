import "server-only";
import { randomBytes } from "node:crypto";
import { runsOnThisComputer } from "@/lib/site-url";
import { parseTokenKey } from "./crypto";
import { FETCH_SCAN, type GmailMessage } from "./message";

// Talking to Google, on the server only. BUDDY_GMAIL_MODE=fake (tests and CI)
// swaps in a stand-in that never contacts Google, like BUDDY_AI_MODE=fake, and
// like it only works when Buddy runs on this computer.

export type GmailStatus = "fake" | "configured" | "not_configured";

export function gmailStatus(): GmailStatus {
  if (process.env.BUDDY_GMAIL_MODE === "fake") {
    if (runsOnThisComputer(process.env)) return "fake";
    console.error("[gmail] BUDDY_GMAIL_MODE=fake is for tests only and is ignored on a live server");
    return "not_configured";
  }
  const ready =
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim() && parseTokenKey(process.env.GMAIL_TOKEN_KEY);
  return ready ? "configured" : "not_configured";
}

// The stand-in needs a key too; one made up when the server starts is enough
// for tests. Kept on globalThis because routes and actions are bundled apart.
const shared = globalThis as typeof globalThis & { buddyGmailFakeKey?: Buffer };

/** The server-only encryption key, or null when it is not set up. */
export function tokenKey(): Buffer | null {
  const key = parseTokenKey(process.env.GMAIL_TOKEN_KEY);
  if (key) return key;
  if (gmailStatus() !== "fake") return null;
  shared.buddyGmailFakeKey ??= randomBytes(32);
  return shared.buddyGmailFakeKey;
}

export function googleClientId() {
  return process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
}

export interface TokenResult {
  refreshToken: string | null;
  accessToken: string;
  scope: string;
}

const TIMEOUT_MS = 15_000;

/** Swaps the one-time code from Google for tokens. Throws on failure (nothing about the tokens is logged). */
export async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<TokenResult> {
  if (gmailStatus() === "fake") {
    return { refreshToken: `fake-refresh-${code}`, accessToken: "fake-access", scope: "https://www.googleapis.com/auth/gmail.readonly" };
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      code_verifier: verifier,
      client_id: googleClientId(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Google token exchange failed with status ${response.status}`);
  const body = (await response.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!body.access_token) throw new Error("Google returned no access token");
  return { refreshToken: body.refresh_token ?? null, accessToken: body.access_token, scope: body.scope ?? "" };
}

/** The connected inbox's address (gmail.readonly allows reading the profile). */
export async function inboxAddress(accessToken: string): Promise<string> {
  if (gmailStatus() === "fake") return "test.inbox@example.com";
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Gmail profile request failed with status ${response.status}`);
  const body = (await response.json()) as { emailAddress?: string };
  if (!body.emailAddress) throw new Error("Gmail returned no address");
  return body.emailAddress;
}

/** Tells Google to cancel Buddy's access. Returns false when Google could not be reached. */
export async function revokeToken(refreshToken: string): Promise<boolean> {
  if (gmailStatus() === "fake") return true;
  try {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 400 means Google already considers it invalid (for example after 7 days in testing mode).
    return response.ok || response.status === 400;
  } catch {
    return false;
  }
}

/** Why talking to Gmail failed: the sign-in has ended, read access is missing, or Google did not answer. */
export class GmailError extends Error {
  constructor(
    readonly kind: "expired" | "scope" | "google",
    message: string,
  ) {
    super(message);
  }
}

// The stand-in inbox: three made-up emails from the last few hours, the same
// for every test on this server.
const fakeInbox = shared as typeof shared & { buddyGmailFakeInbox?: GmailMessage[] };

function encode(text: string) {
  return Buffer.from(text).toString("base64url");
}

function fakeMessages(): GmailMessage[] {
  if (!fakeInbox.buddyGmailFakeInbox) {
    const hour = 3_600_000;
    const now = Date.now();
    fakeInbox.buddyGmailFakeInbox = [
      {
        id: "fake-msg-1",
        internalDate: String(now - 3 * hour),
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: "Priya Shah <Priya.Shah@Example.com>" },
            { name: "Subject", value: "Refund for a double charge" },
          ],
          body: { data: encode("Hello,\r\nI was charged twice this month. Please refund one payment.\r\nPriya") },
        },
      },
      {
        id: "fake-msg-2",
        internalDate: String(now - 2 * hour),
        payload: {
          mimeType: "multipart/alternative",
          headers: [
            { name: "From", value: "tom.baker@example.org" },
            { name: "Subject", value: "App keeps crashing" },
          ],
          parts: [{ mimeType: "text/html", body: { data: encode("<p>The app crashes when I open settings.</p><p>Tom &amp; family</p>") } }],
        },
      },
      {
        id: "fake-msg-3",
        internalDate: String(now - hour),
        snippet: "Thanks for the quick help yesterday",
        payload: { mimeType: "multipart/mixed", headers: [{ name: "From", value: '"Lena Ortiz" <lena@example.net>' }] },
      },
    ];
  }
  return fakeInbox.buddyGmailFakeInbox;
}

/** A short-lived access token from the saved refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  if (gmailStatus() === "fake") return "fake-access";
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: googleClientId(),
        client_secret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GmailError("google", "Google token refresh did not answer");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    // invalid_grant: revoked, or ended after 7 days in testing mode.
    if (body.error === "invalid_grant") throw new GmailError("expired", "Google sign-in has ended");
    throw new GmailError("google", `Google token refresh failed with status ${response.status}`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new GmailError("google", "Google returned no access token");
  return body.access_token;
}

async function gmailGet<T>(accessToken: string, path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GmailError("google", "Gmail did not answer");
  }
  if (response.status === 401) throw new GmailError("expired", "Gmail refused the sign-in");
  if (response.status === 403) throw new GmailError("scope", "Gmail refused access");
  if (!response.ok) throw new GmailError("google", `Gmail request failed with status ${response.status}`);
  return (await response.json()) as T;
}

/** IDs of the messages matching a Gmail search, newest first, and whether there were more than FETCH_SCAN. */
export async function listMessageIds(accessToken: string, query: string): Promise<{ ids: string[]; truncated: boolean }> {
  if (gmailStatus() === "fake") return { ids: fakeMessages().map((m) => m.id).reverse(), truncated: false };
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q: query, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(accessToken, `messages?${params}`);
    for (const m of page.messages ?? []) ids.push(m.id);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < FETCH_SCAN);
  return { ids: ids.slice(0, FETCH_SCAN), truncated: Boolean(pageToken) || ids.length > FETCH_SCAN };
}

/** One message with its headers and text. */
export async function getMessage(accessToken: string, id: string): Promise<GmailMessage> {
  if (gmailStatus() === "fake") {
    const message = fakeMessages().find((m) => m.id === id);
    if (!message) throw new GmailError("google", "Message not found");
    return message;
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new GmailError("google", "Unexpected message ID");
  return gmailGet<GmailMessage>(accessToken, `messages/${id}?format=full`);
}
