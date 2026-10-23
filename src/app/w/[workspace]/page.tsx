import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { InviteForm, MemberRow } from "@/components/org/members";
import { cancelInvitation } from "@/app/actions/organizations";
import { requireUser } from "@/lib/auth";
import { getMembershipBySlug, listMembers, listOpenInvitations } from "@/lib/data/live";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const roleLabels = { owner: "Owner", admin: "Admin", member: "Member" } as const;

export default async function LiveWorkspaceHome({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const user = await requireUser(`/w/${slug}`);
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership) notFound();

  const { organization, role } = membership;
  const isAdmin = role === "owner" || role === "admin";
  const [members, invitations] = await Promise.all([
    listMembers(organization.id),
    isAdmin ? listOpenInvitations(organization.id) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title={organization.name}
        description={`You are ${role === "admin" ? "an" : "a"} ${roleLabels[role].toLowerCase()} of this workspace.`}
      />

      <div className="mb-6 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Your workspace is set up.</p>
        <p className="mt-1">
          The issues inbox, dashboard, teams, routing rules and settings arrive here in the next stages of Phase 2. Until
          then, you can{" "}
          <Link href="/demo/brightline" className="font-medium text-brand-700 hover:underline">
            explore them in the demo
          </Link>
          .
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Members" description={`${members.length} ${members.length === 1 ? "person" : "people"}`}>
          <ul className="-my-3 divide-y divide-slate-100">
            {members.map((m) => (
              <MemberRow
                key={m.userId}
                organizationId={organization.id}
                member={m}
                myRole={role}
                isMe={m.userId === user.id}
              />
            ))}
          </ul>
        </Card>

        {isAdmin && (
          <Card title="Invite a colleague" description="They join with the role you choose.">
            <InviteForm organizationId={organization.id} />
            {invitations.length > 0 && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Open invitations</h3>
                <ul className="mt-2 divide-y divide-slate-100">
                  {invitations.map((inv) => (
                    <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate text-slate-900">{inv.email}</span>
                        <span className="text-xs text-slate-500">
                          {roleLabels[inv.role]} ·{" "}
                          {new Date(inv.expiresAt) < new Date() ? "expired" : `expires ${formatDate(inv.expiresAt)}`}
                        </span>
                      </span>
                      <form action={cancelInvitation}>
                        <input type="hidden" name="invitationId" value={inv.id} />
                        <button type="submit" className="text-xs font-medium text-red-700 hover:underline">
                          Cancel
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
