import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gmailStatus } from "@/lib/gmail";
import { decryptToken, encryptToken, parseTokenKey } from "@/lib/gmail/crypto";
import {
  GMAIL_SCOPE,
  buildAuthUrl,
  decodeOAuthCookie,
  encodeOAuthCookie,
  gmailCallbackUrl,
  grantedReadonly,
  newOAuthSecrets,
} from "@/lib/gmail/oauth";

describe("token encryption", () => {
  const key = randomBytes(32);

  it("round-trips and never stores the token as plain text", () => {
    const stored = encryptToken("1//refresh-token-value", key);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("refresh-token-value");
    expect(decryptToken(stored, key)).toBe("1//refresh-token-value");
    // A fresh random start each time, so the same token never looks the same.
    expect(encryptToken("1//refresh-token-value", key)).not.toBe(stored);
  });

  it("refuses another key or a changed value", () => {
    const stored = encryptToken("secret", key);
    expect(decryptToken(stored, randomBytes(32))).toBeNull();
    const parts = stored.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(decryptToken(parts.join(":"), key)).toBeNull();
    expect(decryptToken("not-ours", key)).toBeNull();
  });

  it("accepts only a 32-byte base64 key", () => {
    expect(parseTokenKey(randomBytes(32).toString("base64"))).toHaveLength(32);
    expect(parseTokenKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseTokenKey("")).toBeNull();
    expect(parseTokenKey(undefined)).toBeNull();
  });
});

describe("Google sign-in", () => {
  it("asks only for read-only Gmail, with lasting access and PKCE", () => {
    const { state, challenge } = newOAuthSecrets();
    const url = new URL(buildAuthUrl({ clientId: "client", redirectUri: "http://localhost:3000/api/gmail/callback", state, challenge }));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(GMAIL_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(state);
  });

  it("makes new one-time values every time", () => {
    const a = newOAuthSecrets();
    const b = newOAuthSecrets();
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
  });

  it("reads back only its own cookie", () => {
    const value = { state: "s", verifier: "v", slug: "outskill" };
    expect(decodeOAuthCookie(encodeOAuthCookie(value))).toEqual(value);
    expect(decodeOAuthCookie("garbage")).toBeNull();
    expect(decodeOAuthCookie(undefined)).toBeNull();
  });

  it("checks that read-only Gmail access was really granted", () => {
    expect(grantedReadonly(`openid ${GMAIL_SCOPE}`)).toBe(true);
    expect(grantedReadonly("openid email")).toBe(false);
    expect(grantedReadonly(undefined)).toBe(false);
  });
});

describe("Google's return address", () => {
  const request = "https://evil.example/api/gmail/connect?workspace=acme";

  it("on a live server comes from BUDDY_SITE_URL, never the request", () => {
    expect(gmailCallbackUrl({ NODE_ENV: "production", BUDDY_SITE_URL: "https://buddy.example.com/" }, request)).toBe(
      "https://buddy.example.com/api/gmail/callback",
    );
    expect(gmailCallbackUrl({ NODE_ENV: "production" }, request)).toBeNull();
    expect(gmailCallbackUrl({ NODE_ENV: "production", BUDDY_SITE_URL: "not a web address" }, request)).toBeNull();
  });

  it("on your computer uses the address Buddy was opened on", () => {
    expect(gmailCallbackUrl({ NODE_ENV: "development" }, "http://localhost:3000/api/gmail/connect")).toBe(
      "http://localhost:3000/api/gmail/callback",
    );
  });
});

describe("Gmail test mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("works on this computer and is refused on a live server", () => {
    vi.stubEnv("BUDDY_GMAIL_MODE", "fake");
    expect(gmailStatus()).toBe("fake");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BUDDY_SITE_URL", "https://buddy.example.com");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(gmailStatus()).toBe("not_configured");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("BUDDY_GMAIL_MODE=fake"));
    log.mockRestore();
  });
});
