import { describe, expect, it } from "vitest";
import { normaliseSiteUrl, resolveSiteUrl, SITE_URL_MISSING } from "@/lib/site-url";

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
const attacker = headers({ origin: "https://evil.example", host: "evil.example" });

describe("normaliseSiteUrl", () => {
  it("keeps the address and drops a trailing slash", () => {
    expect(normaliseSiteUrl("https://buddy.example.com/")).toBe("https://buddy.example.com");
    expect(normaliseSiteUrl(" http://localhost:3000 ")).toBe("http://localhost:3000");
    expect(normaliseSiteUrl("https://example.com/buddy/")).toBe("https://example.com/buddy");
  });

  it("refuses anything that is not a plain web address", () => {
    expect(normaliseSiteUrl("")).toBeNull();
    expect(normaliseSiteUrl("buddy.example.com")).toBeNull();
    expect(normaliseSiteUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseSiteUrl("https://user:pass@buddy.example.com")).toBeNull();
    expect(normaliseSiteUrl("https://buddy.example.com/?next=x")).toBeNull();
  });
});

describe("resolveSiteUrl", () => {
  it("uses BUDDY_SITE_URL and ignores the request headers", () => {
    expect(resolveSiteUrl({ BUDDY_SITE_URL: "https://buddy.example.com/", NODE_ENV: "production" }, attacker)).toEqual({
      url: "https://buddy.example.com",
    });
  });

  it("refuses on a live server when BUDDY_SITE_URL is missing or broken", () => {
    expect(resolveSiteUrl({ NODE_ENV: "production" }, attacker)).toEqual({ error: SITE_URL_MISSING });
    expect(resolveSiteUrl({ BUDDY_SITE_URL: "not a url", NODE_ENV: "development" }, attacker)).toEqual({
      error: SITE_URL_MISSING,
    });
  });

  it("uses the address you opened Buddy on during development", () => {
    expect(resolveSiteUrl({ NODE_ENV: "development" }, headers({ origin: "http://localhost:3000" }))).toEqual({
      url: "http://localhost:3000",
    });
    expect(resolveSiteUrl({ NODE_ENV: "development" }, headers({ host: "localhost:3100" }))).toEqual({
      url: "http://localhost:3100",
    });
  });
});
