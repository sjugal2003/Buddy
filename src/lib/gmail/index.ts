import "server-only";
import { randomBytes } from "node:crypto";
import { parseTokenKey } from "./crypto";

// Talking to Google, on the server only. BUDDY_GMAIL_MODE=fake (tests and CI)
// swaps in a stand-in that never contacts Google, like BUDDY_AI_MODE=fake.

export type GmailStatus = "fake" | "configured" | "not_configured";

export function gmailStatus(): GmailStatus {
  if (process.env.BUDDY_GMAIL_MODE === "fake") return "fake";
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
