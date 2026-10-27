import { describe, expect, it } from "vitest";
import { isNotificationKind, notificationHref, notificationKindLabels, unreadBadge, unreadLabel } from "@/lib/notifications";

describe("notificationHref", () => {
  it("links to the issue when there is one", () => {
    expect(notificationHref("acme", "escalation", "1b4e28ba-2fa1-4d2b-a0f5-1a2b3c4d5e6f")).toBe(
      "/w/acme/issues/1b4e28ba-2fa1-4d2b-a0f5-1a2b3c4d5e6f",
    );
  });

  it("links to the right page for each kind without an issue", () => {
    expect(notificationHref("acme", "import_problem", null)).toBe("/w/acme/data-sources");
    expect(notificationHref("acme", "scheduler_failed", null)).toBe("/w/acme/settings");
    expect(notificationHref("acme", "urgent_issue", null)).toBe("/w/acme/issues");
    expect(notificationHref("acme", "escalation", null)).toBe("/w/acme/issues?escalated=open");
    // A summary of many issues for a team opens the Issues list.
    expect(notificationHref("acme", "team_issue", null)).toBe("/w/acme/issues");
  });

  it("always stays inside the workspace", () => {
    expect(notificationHref("acme", "escalation", "../../evil")).toBe("/w/acme/issues/..%2F..%2Fevil");
    expect(notificationHref("a/b", "import_problem", null)).toBe("/w/a%2Fb/data-sources");
  });
});

describe("unread count", () => {
  it("shows no number when nothing is unread or the count is missing", () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(-1)).toBeNull();
    expect(unreadBadge(null)).toBeNull();
    expect(unreadBadge(Number.NaN)).toBeNull();
  });

  it("shows the number, and 99+ above 99", () => {
    expect(unreadBadge(1)).toBe("1");
    expect(unreadBadge(99)).toBe("99");
    expect(unreadBadge(100)).toBe("99+");
  });

  it("describes the count in words", () => {
    expect(unreadLabel(0)).toBe("Notifications, none unread");
    expect(unreadLabel(3)).toBe("Notifications, 3 unread");
    expect(unreadLabel(null)).toBe("Notifications");
  });
});

describe("isNotificationKind", () => {
  it("accepts only the kinds the database stores", () => {
    expect(isNotificationKind("escalation")).toBe(true);
    expect(isNotificationKind("scheduler_failed")).toBe(true);
    expect(isNotificationKind("team_issue")).toBe(true);
    expect(isNotificationKind("email")).toBe(false);
  });
});

describe("notificationKindLabels", () => {
  it("names team notifications for the person reading them", () => {
    expect(notificationKindLabels.team_issue).toBe("Your team");
  });
});
