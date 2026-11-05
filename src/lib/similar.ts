// Pure helpers for similar issues and "same problem" links (improvement D,
// step 1). Matching itself happens in the database (public.similar_issues).

/** At or above this score (0 to 1) a match is "very similar"; below it, "similar". */
export const VERY_SIMILAR = 0.55;

export function similarityLabel(score: number): "Very similar" | "Similar" {
  return score >= VERY_SIMILAR ? "Very similar" : "Similar";
}

/** "Reported 3 times" for a main issue with 2 linked reports, or null when it has none. */
export function reportedTimes(linkedReports: number): string | null {
  if (!Number.isInteger(linkedReports) || linkedReports < 1) return null;
  return `Reported ${linkedReports + 1} times`;
}

/** The Issues list badge: "+1 report", "+3 reports", or null. */
export function reportsBadge(linkedReports: number): string | null {
  if (!Number.isInteger(linkedReports) || linkedReports < 1) return null;
  return `+${linkedReports} ${linkedReports === 1 ? "report" : "reports"}`;
}

/**
 * The open main issues with the most linked reports, most first (ties: the
 * newest issue first), at most `limit`. `reports` counts linked reports per
 * main issue; only the issues in `open` are kept.
 */
export function mostReported<T extends { id: string; receivedAt: string }>(
  reports: Map<string, number>,
  open: T[],
  limit: number,
): (T & { reports: number })[] {
  return open
    .filter((issue) => (reports.get(issue.id) ?? 0) > 0)
    .map((issue) => ({ ...issue, reports: reports.get(issue.id)! }))
    .sort((a, b) => b.reports - a.reports || b.receivedAt.localeCompare(a.receivedAt) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
