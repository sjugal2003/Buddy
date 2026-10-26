import { createHash, randomBytes } from "node:crypto";
import { normaliseSiteUrl } from "@/lib/site-url";

// Google sign-in for one Gmail inbox, read-only. Only gmail.readonly is asked
// for: Buddy can read messages but can never send, delete or change email.

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const OAUTH_COOKIE = "buddy_gmail_oauth";
export const OAUTH_COOKIE_PATH = "/api/gmail";
/** Ten minutes to finish signing in with Google. */
export const OAUTH_COOKIE_MAX_AGE = 600;

export interface OAuthCookie {
  state: string;
  verifier: string;
  slug: string;
}

/** A one-time state value and a PKCE verifier/challenge pair. */
export function newOAuthSecrets() {
  const verifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(24).toString("base64url"),
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

export function buildAuthUrl(options: { clientId: string; redirectUri: string; state: string; challenge: string }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    // A refresh token, so Buddy can fetch later without asking again (until Google's testing-mode limit).
    access_type: "offline",
    prompt: "consent",
    state: options.state,
    code_challenge: options.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export function encodeOAuthCookie(value: OAuthCookie) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeOAuthCookie(raw: string | undefined): OAuthCookie | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof value?.state === "string" && typeof value?.verifier === "string" && typeof value?.slug === "string") {
      return { state: value.state, verifier: value.verifier, slug: value.slug };
    }
  } catch {
    // Not ours, or changed: treated as missing.
  }
  return null;
}

/** Whether Google granted read-only Gmail access (people can untick it on Google's screen). */
export function grantedReadonly(scope: string | undefined) {
  return (scope ?? "").split(/\s+/).includes(GMAIL_SCOPE);
}

/** What each ?gmail= result on the Data sources page means. */
export const gmailResultMessages: Record<string, string> = {
  cancelled: "Gmail was not connected: the Google sign-in was cancelled.",
  expired: "The Google sign-in took too long or was started in another browser. Please try again.",
  not_owner: "Only owners can connect or disconnect the inbox.",
  not_configured:
    "Gmail is not set up on this server yet (add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GMAIL_TOKEN_KEY to .env.local; a live server also needs BUDDY_SITE_URL).",
  scope: "Gmail was not connected: Buddy needs permission to read email. Tick that box on Google's screen and try again.",
  no_refresh: "Google did not give Buddy lasting access. Remove Buddy at myaccount.google.com/permissions, then connect again.",
  google_failed: "Google could not complete the sign-in. Please try again in a minute.",
  save_failed: "Gmail could not be connected because the connection was not saved. Please try again.",
};

/**
 * Where Google sends the owner back. On a live server it is built from
 * BUDDY_SITE_URL, like every link that leaves the site (null when that is
 * missing); on your computer, from the address you opened Buddy on. Either way
 * it must also be listed in the Google Cloud project, or Google refuses it.
 */
export function gmailCallbackUrl(env: { BUDDY_SITE_URL?: string; NODE_ENV?: string }, requestUrl: string) {
  if (env.NODE_ENV !== "production") return new URL("/api/gmail/callback", requestUrl).toString();
  const site = normaliseSiteUrl(env.BUDDY_SITE_URL);
  return site ? `${site}/api/gmail/callback` : null;
}
