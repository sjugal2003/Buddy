import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceProvider } from "@/components/workspace/workspace-store";
import {
  DEMO_NOW,
  getAutomationSettings,
  getWorkspaceBySlug,
  listCategories,
  listIssues,
  listRoutingRules,
  listTeams,
  listWorkspaces,
} from "@/lib/data";

// In Phase 2 this layout is where we will check that the signed-in user is a
// member of this workspace before loading any of its data.

export async function generateStaticParams() {
  return (await listWorkspaces()).map((w) => ({ workspace: w.slug }));
}

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) notFound();

  const [workspaces, teams, categories, issues, rules, automation] = await Promise.all([
    listWorkspaces(),
    listTeams(workspace.id),
    listCategories(workspace.id),
    listIssues(workspace.id),
    listRoutingRules(workspace.id),
    getAutomationSettings(workspace.id),
  ]);
  if (!automation) notFound();

  return (
    <WorkspaceProvider
      key={workspace.id}
      nowIso={DEMO_NOW.toISOString()}
      initial={{ workspace, workspaces, teams, categories, issues, rules, automation }}
    >
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
