import { describe, expect, it } from "vitest";
import { issueListHref, pageRange } from "@/lib/paging";

const none = { status: "active", urgency: "", team: "", due: "", escalated: "", sort: "", week: "", mine: "", q: "" };

describe("Issues list paging links", () => {
  it("leaves out defaults and page 1", () => {
    expect(issueListHref("/w/acme/issues", none, 1)).toBe("/w/acme/issues");
    expect(issueListHref("/w/acme/issues", none, 2)).toBe("/w/acme/issues?page=2");
  });

  it("keeps every filter when changing page", () => {
    const filters = { ...none, status: "all", urgency: "urgent", week: "1", mine: "1", sort: "attention", q: "late order" };
    const href = issueListHref("/w/acme/issues", filters, 3);
    const params = new URL(href, "http://x").searchParams;
    expect(Object.fromEntries(params)).toEqual({
      status: "all",
      urgency: "urgent",
      week: "1",
      mine: "1",
      sort: "attention",
      q: "late order",
      page: "3",
    });
    expect(issueListHref("/w/acme/issues", filters, 1)).not.toContain("page=");
  });

  it("encodes search text safely", () => {
    expect(issueListHref("/w/acme/issues", { ...none, q: "a&b=c" }, 2)).toBe("/w/acme/issues?q=a%26b%3Dc&page=2");
  });

  it("numbers the issues on a page", () => {
    expect(pageRange(1, 50, 50)).toEqual({ first: 1, last: 50 });
    expect(pageRange(2, 50, 10)).toEqual({ first: 51, last: 60 });
  });
});
