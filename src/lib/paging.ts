// Addresses for the Issues list's Previous / Next links. Pure, so it can be
// unit tested. Default values are left out to keep addresses short; the
// filters themselves are checked again by issueFiltersSchema on the next load.

export type IssueListQuery = {
  status: string;
  urgency: string;
  team: string;
  due: string;
  escalated: string;
  sort: string;
  week: string;
  mine: string;
  q: string;
};

const DEFAULTS: IssueListQuery = {
  status: "active",
  urgency: "",
  team: "",
  due: "",
  escalated: "",
  sort: "",
  week: "",
  mine: "",
  q: "",
};

/** The Issues list address for `page`, keeping every filter. Page 1 has no page number. */
export function issueListHref(base: string, filters: IssueListQuery, page: number): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(DEFAULTS) as (keyof IssueListQuery)[]) {
    const value = filters[key];
    if (value !== DEFAULTS[key]) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** "Issues 51 to 100" for page 2 with 50 issues on it. */
export function pageRange(page: number, pageSize: number, shown: number): { first: number; last: number } {
  const first = (page - 1) * pageSize + 1;
  return { first, last: first + shown - 1 };
}
