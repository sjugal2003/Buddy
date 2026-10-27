// In-app notifications (Phase 6). Pure helpers shared by the bell and the
// Notifications page. Notifications are created only by the database; these
// decide how one is labelled and where it links to.

export type NotificationKind = "escalation" | "urgent_issue" | "import_problem" | "scheduler_failed" | "team_issue";

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  "escalation",
  "urgent_issue",
  "import_problem",
  "scheduler_failed",
  "team_issue",
];

/** How many notifications the Notifications page shows. */
export const NOTIFICATION_LIST_LIMIT = 50;

export const notificationKindLabels: Record<NotificationKind, string> = {
  escalation: "Escalation",
  urgent_issue: "Urgent issue",
  import_problem: "Import",
  scheduler_failed: "Scheduled check",
  team_issue: "Your team",
};

export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/**
 * Where a notification leads inside the workspace. Built here from the kind
 * and the issue ID, never stored as a free link, so a notification can only
 * point at a page of the same workspace.
 */
export function notificationHref(slug: string, kind: NotificationKind, issueId: string | null) {
  const base = `/w/${encodeURIComponent(slug)}`;
  if (issueId) return `${base}/issues/${encodeURIComponent(issueId)}`;
  if (kind === "import_problem") return `${base}/data-sources`;
  if (kind === "scheduler_failed") return `${base}/settings`;
  // A summary of many escalations opens the list of unacknowledged ones.
  if (kind === "escalation") return `${base}/issues?escalated=open`;
  return `${base}/issues`;
}

/** The number on the bell: nothing at 0, "99+" above 99. */
export function unreadBadge(count: number | null) {
  if (count === null || !Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** Words for screen readers and the bell's tooltip. */
export function unreadLabel(count: number | null) {
  if (count === null || !Number.isFinite(count)) return "Notifications";
  if (count <= 0) return "Notifications, none unread";
  return `Notifications, ${count} unread`;
}
