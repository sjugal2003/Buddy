import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMembershipBySlug } from "@/lib/data/live";
import { gmailStatus, googleClientId } from "@/lib/gmail";
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_MAX_AGE,
  OAUTH_COOKIE_PATH,
  buildAuthUrl,
  encodeOAuthCookie,
  newOAuthSecrets,
} from "@/lib/gmail/oauth";

// "Connect Gmail" (owners only) starts here: it remembers a one-time state in
// a short-lived cookie and sends the owner to Google's sign-in screen.

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!/^[a-z0-9-]{1,63}$/.test(slug)) return NextResponse.redirect(new URL("/", request.url));
  const back = (result: string) => NextResponse.redirect(new URL(`/w/${slug}/data-sources?gmail=${result}`, request.url));

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=/w/${slug}/data-sources`, request.url));
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership) return NextResponse.redirect(new URL("/", request.url));
  if (membership.role !== "owner") return back("not_owner");

  const status = gmailStatus();
  if (status === "not_configured") return back("not_configured");

  const { state, verifier, challenge } = newOAuthSecrets();
  const redirectUri = new URL("/api/gmail/callback", request.url).toString();
  const target =
    status === "fake"
      ? // The stand-in skips Google and comes straight back, as Google would.
        `${redirectUri}?code=test-code&state=${state}`
      : buildAuthUrl({ clientId: googleClientId(), redirectUri, state, challenge });
  const response = NextResponse.redirect(target);
  response.cookies.set(OAUTH_COOKIE, encodeOAuthCookie({ state, verifier, slug }), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_MAX_AGE,
  });
  return response;
}
