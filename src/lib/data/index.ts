// The single place pages get data from.
//
// Phase 1: everything comes from local demo files.
// Phase 2: these functions will query the database instead, and will check
// that the signed-in user belongs to the workspace before returning anything.
// Pages should never import from "@/lib/demo-data" directly.

import { categories, teams, workspaces } from "@/lib/demo-data/workspaces";
import { DEMO_NOW, issues } from "@/lib/demo-data/issues";
import { automationSettings, dataSourceCatalog, routingRules } from "@/lib/demo-data/settings";

export { DEMO_NOW };

export async function listWorkspaces() {
  return workspaces;
}

export async function getWorkspaceBySlug(slug: string) {
  return workspaces.find((w) => w.slug === slug) ?? null;
}

export async function listTeams(workspaceId: string) {
  return teams.filter((t) => t.workspaceId === workspaceId);
}

export async function listCategories(workspaceId: string) {
  return categories.filter((c) => c.workspaceId === workspaceId);
}

export async function listIssues(workspaceId: string) {
  return issues.filter((i) => i.workspaceId === workspaceId);
}

export async function listRoutingRules(workspaceId: string) {
  return routingRules.filter((r) => r.workspaceId === workspaceId);
}

export async function getAutomationSettings(workspaceId: string) {
  return automationSettings.find((a) => a.workspaceId === workspaceId) ?? null;
}

export async function listDataSourceCatalog() {
  return dataSourceCatalog;
}
