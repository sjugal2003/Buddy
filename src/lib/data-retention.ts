// Deleting customer data and how long resolved issues are kept (Phase 7
// stage 37). The database does the deleting (delete_issue,
// delete_customer_data, private.apply_retention); this is only wording.

/** Choices for "Keep resolved issues for". null keeps them. */
export const RETENTION_OPTIONS: { days: number | null; label: string }[] = [
  { days: null, label: "Keep them (don't delete automatically)" },
  { days: 90, label: "90 days after they are resolved" },
  { days: 180, label: "180 days after they are resolved" },
  { days: 365, label: "1 year after they are resolved" },
  { days: 730, label: "2 years after they are resolved" },
  { days: 1825, label: "5 years after they are resolved" },
];

export const RETENTION_DAYS = RETENTION_OPTIONS.flatMap((o) => (o.days === null ? [] : [o.days]));

export function retentionLabel(days: number | null): string {
  if (days === null) return "Kept until someone deletes them";
  const option = RETENTION_OPTIONS.find((o) => o.days === days);
  return option ? `Deleted ${option.label}` : `Deleted ${days} days after they are resolved`;
}

export type DeletionKind = "issue" | "customer" | "retention";

export interface DeletionLogEntry {
  id: number;
  kind: DeletionKind;
  issueCount: number;
  reference: string | null;
  deletedByName: string | null;
  createdAt: string;
}

/** One line of the deletion log. Never holds customer details. */
export function describeDeletion(entry: Pick<DeletionLogEntry, "kind" | "issueCount" | "reference" | "deletedByName">): string {
  const who = entry.deletedByName ?? "A former member";
  const issues = `${entry.issueCount} ${entry.issueCount === 1 ? "issue" : "issues"}`;
  switch (entry.kind) {
    case "issue":
      return `${who} deleted issue ${entry.reference ?? "(no reference)"}`;
    case "customer":
      return `${who} deleted a customer's data (${issues})`;
    case "retention":
      return `Automatic clean-up deleted ${issues} resolved longer ago than the company keeps them`;
  }
}
