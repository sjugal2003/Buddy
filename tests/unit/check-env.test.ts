import { describe, expect, it } from "vitest";
import { checkEnv, parseEnvFile } from "../../scripts/check-env-plan.mjs";

// Made-up values only: none of these is a real key.
const base = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_made-up",
};
const tokenKey = Buffer.alloc(32, 7).toString("base64");
const serviceRoleJwt = ["e30", Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url"), "sig"].join(".");

describe("checkEnv", () => {
  it("lists every setting as set or missing and never returns a value", () => {
    const vars = { ...base, GEMINI_API_KEY: "made-up-gemini-value", BUDDY_AI_RESULT_KEY: "x".repeat(40) };
    const result = checkEnv(vars);
    expect(result.rows.find((row) => row.name === "GEMINI_API_KEY")).toMatchObject({ set: true, secret: true });
    expect(result.rows.find((row) => row.name === "ANTHROPIC_API_KEY")).toMatchObject({ set: false });
    expect(result.errors).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("made-up-gemini-value");
    expect(JSON.stringify(result)).not.toContain("sb_publishable_made-up");
  });

  it("needs the two Supabase settings", () => {
    expect(checkEnv({}).errors).toHaveLength(2);
  });

  it("refuses secrets with a NEXT_PUBLIC_ name and Supabase secret keys under any name", () => {
    const { errors } = checkEnv({
      ...base,
      NEXT_PUBLIC_GEMINI_API_KEY: "made-up",
      SUPABASE_KEY: "sb_secret_made-up",
      OLD_KEY: serviceRoleJwt,
    });
    expect(errors.some((e) => e.startsWith("NEXT_PUBLIC_GEMINI_API_KEY"))).toBe(true);
    expect(errors.some((e) => e.startsWith("SUPABASE_KEY") && e.includes("secret"))).toBe(true);
    expect(errors.some((e) => e.startsWith("OLD_KEY"))).toBe(true);
    expect(JSON.stringify(errors)).not.toContain("sb_secret_made-up");
  });

  it("on a live server needs an https address that isn't localhost, and no test modes", () => {
    expect(checkEnv(base, { live: true }).errors.join()).toContain("BUDDY_SITE_URL is missing");
    expect(checkEnv({ ...base, BUDDY_SITE_URL: "http://buddy.example.com" }, { live: true }).errors.join()).toContain("https://");
    expect(checkEnv({ ...base, BUDDY_SITE_URL: "https://localhost:3000" }, { live: true }).errors.join()).toContain("localhost");
    expect(checkEnv({ ...base, BUDDY_SITE_URL: "https://buddy.example.com", BUDDY_AI_MODE: "fake" }, { live: true }).errors.join()).toContain("BUDDY_AI_MODE");
    expect(checkEnv({ ...base, BUDDY_SITE_URL: "https://buddy.example.com" }, { live: true }).errors).toEqual([]);
  });

  it("only warns about test modes on this computer", () => {
    const result = checkEnv({ ...base, BUDDY_GMAIL_MODE: "fake" });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join()).toContain("BUDDY_GMAIL_MODE");
  });

  it("refuses an address that isn't a plain web address", () => {
    expect(checkEnv({ ...base, BUDDY_SITE_URL: "buddy.example.com" }).errors.join()).toContain("plain web address");
  });

  it("warns when AI or Gmail is half set up", () => {
    expect(checkEnv({ ...base, GEMINI_API_KEY: "made-up" }).warnings.join()).toContain("npm.cmd run ai-key");
    expect(checkEnv({ ...base, BUDDY_AI_RESULT_KEY: "short", ANTHROPIC_API_KEY: "made-up" }).warnings.join()).toContain("too short");
    expect(checkEnv({ ...base, GOOGLE_CLIENT_ID: "made-up" }).warnings.join()).toContain("GOOGLE_CLIENT_SECRET, GMAIL_TOKEN_KEY");
    expect(checkEnv({ ...base, GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", GMAIL_TOKEN_KEY: "c2hvcnQ=" }).warnings.join()).toContain("32 random bytes");
    expect(checkEnv({ ...base, GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", GMAIL_TOKEN_KEY: tokenKey }).warnings).toEqual([]);
  });
});

describe("parseEnvFile", () => {
  it("reads KEY=value lines and skips comments", () => {
    const text = "# comment\r\nNEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co\n\n# GEMINI_API_KEY=old\nBUDDY_SITE_URL=\"http://localhost:3000\"\nexport GMAIL_TOKEN_KEY='abc='\nnot a line\n";
    expect(parseEnvFile(text)).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      BUDDY_SITE_URL: "http://localhost:3000",
      GMAIL_TOKEN_KEY: "abc=",
    });
  });
});
