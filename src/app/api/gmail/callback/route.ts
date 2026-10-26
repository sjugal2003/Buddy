import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMembershipBySlug } from "@/lib/data/live";
import { exchangeCode, gmailStatus, inboxAddress, tokenKey } from "@/lib/gmail";
import { encryptToken } from "@/lib/gmail/crypto";
import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, decodeOAuthCookie, gmailCallbackUrl, grantedReadonly } from "@/lib/gmail/oauth";
import { createClient } from "@/lib/supabase/server";

// Google sends the owner back here. The connection is saved only if the
// one-time state matches, the person is still an owner of that company, and
// Google granted read-only Gmail access. The token is encrypted before it is
// stored, and nothing about it is logged.

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const saved = decodeOAuthCookie(request.cookies.get(OAUTH_COOKIE)?.value);
  const finish = (path: string) => {
    const response = NextResponse.redirect(new URL(path, request.url));
    response.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return response;
  };
  if (!saved) return finish("/");
  const back = (result: string) => finish(`/w/${saved.slug}/data-sources?gmail=${result}`);

  if (!same(params.get("state") ?? "", saved.state)) return back("expired");
  if (params.get("error")) return back("cancelled");
  const code = params.get("code");
  if (!code) return back("expired");

  const user = await getCurrentUser();
  if (!user) return finish(`/login?next=/w/${saved.slug}/data-sources`);
  const membership = await getMembershipBySlug(user.id, saved.slug);
  if (!membership) return finish("/");
  if (membership.role !== "owner") return back("not_owner");
  const key = tokenKey();
  const redirectUri = gmailCallbackUrl(process.env, request.url);
  if (gmailStatus() === "not_configured" || !key || !redirectUri) return back("not_configured");

  let address: string;
  let encrypted: string;
  try {
    const tokens = await exchangeCode(code, saved.verifier, redirectUri);
    if (!grantedReadonly(tokens.scope)) return back("scope");
    if (!tokens.refreshToken) return back("no_refresh");
    address = await inboxAddress(tokens.accessToken);
    encrypted = encryptToken(tokens.refreshToken, key);
  } catch (error) {
    console.error("[gmail/callback] Google step failed:", error instanceof Error ? error.message : "unknown");
    return back("google_failed");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_mailbox_connection", {
    p_organization_id: membership.organization.id,
    p_email: address,
    p_encrypted_token: encrypted,
  });
  if (error) {
    console.error("[gmail/callback] save", error.code);
    return back("save_failed");
  }
  return back("connected");
}
