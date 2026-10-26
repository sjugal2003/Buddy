import "server-only";
import { headers } from "next/headers";

// Buddy's own web address, for links that are opened later from somewhere
// else: the sign-up confirmation email and invitation links (Phase 7 stage 36).
//
// On a live server it must come from BUDDY_SITE_URL, never from the request:
// the Host and Origin headers are written by whoever sends the request, so a
// link built from them could point at someone else's site. On your own
// computer (npm run dev) the address you opened Buddy on is used when
// BUDDY_SITE_URL is not set.

export type SiteUrlResult = { url: string } | { error: string };

export const SITE_URL_MISSING =
  "Buddy's web address is not set up yet (BUDDY_SITE_URL), so no link can be sent. Please tell the person who runs Buddy.";

/** "https://buddy.example.com" from "https://buddy.example.com/", or null when unusable. */
export function normaliseSiteUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * True when Buddy runs on this computer: the dev server, or a live build whose
 * BUDDY_SITE_URL is localhost (how the automated tests run it). The test-only
 * stand-ins (BUDDY_AI_MODE=fake, BUDDY_GMAIL_MODE=fake) work only then, so
 * they can't show made-up results as real on a live server (stage 39).
 */
export function runsOnThisComputer(env: { BUDDY_SITE_URL?: string; NODE_ENV?: string }) {
  if (env.NODE_ENV !== "production") return true;
  const url = normaliseSiteUrl(env.BUDDY_SITE_URL);
  if (!url) return false;
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** Only for development: the address the browser used, from the request headers. */
function devOrigin(headers: { get(name: string): string | null }) {
  const origin = headers.get("origin");
  if (origin) return origin;
  return `http://${headers.get("host") ?? "localhost:3000"}`;
}

/** Pure, so tests can check every case; `siteUrl()` passes in the real values. */
export function resolveSiteUrl(
  env: { BUDDY_SITE_URL?: string; NODE_ENV?: string },
  headers: { get(name: string): string | null },
): SiteUrlResult {
  if (env.BUDDY_SITE_URL?.trim()) {
    const url = normaliseSiteUrl(env.BUDDY_SITE_URL);
    return url ? { url } : { error: SITE_URL_MISSING };
  }
  if (env.NODE_ENV === "production") return { error: SITE_URL_MISSING };
  return { url: devOrigin(headers) };
}

/** Buddy's web address for links in emails and invitations. */
export async function siteUrl() {
  const result = resolveSiteUrl(process.env, await headers());
  if ("error" in result) console.error("[siteUrl] BUDDY_SITE_URL is missing or not a valid web address");
  return result;
}
