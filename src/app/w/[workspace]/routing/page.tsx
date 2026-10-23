import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { AddRule, RouteUnassignedButton, RuleRow } from "@/components/routing/routing-forms";
import { requireUser } from "@/lib/auth";
import { getMembershipBySlug, listCategories, listRoutingRules, listTeams } from "@/lib/data/live";

export const dynamic = "force-dynamic";

export default async function RoutingPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const user = await requireUser(`/w/${slug}/routing`);
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership) notFound();

  const orgId = membership.organization.id;
  // Only decides which buttons to show; the database refuses members' changes.
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const [rules, teams, categories] = await Promise.all([
    listRoutingRules(orgId),
    listTeams(orgId),
    listCategories(orgId),
  ]);

  return (
    <>
      <PageHeader
        title="Routing rules"
        description="Rules suggest which team should handle an issue. They are checked from top to bottom and the first match wins. Nothing moves until someone applies a suggestion."
      />

      <div className="space-y-6">
        <Card
          title="Rules"
          description={`${rules.length} ${rules.length === 1 ? "rule" : "rules"}${canEdit ? "" : ". Only owners and admins can change them."}`}
          action={rules.length > 0 ? <RouteUnassignedButton organizationId={orgId} /> : undefined}
        >
          {rules.length === 0 ? (
            <p className="text-sm text-slate-500">No rules yet.</p>
          ) : (
            <ol className="-my-4 divide-y divide-slate-100">
              {rules.map((rule, index) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  index={index}
                  count={rules.length}
                  teams={teams}
                  categories={categories}
                  canEdit={canEdit}
                />
              ))}
            </ol>
          )}
        </Card>

        {canEdit && (
          <Card title="Add a rule">
            {teams.length === 0 ? (
              <p className="text-sm text-slate-600">
                Rules suggest a team, so add a team first under{" "}
                <Link href={`/w/${slug}/settings`} className="font-medium text-brand-700 hover:underline">
                  Settings
                </Link>
                .
              </p>
            ) : (
              <AddRule organizationId={orgId} teams={teams} categories={categories} />
            )}
          </Card>
        )}
      </div>
    </>
  );
}
