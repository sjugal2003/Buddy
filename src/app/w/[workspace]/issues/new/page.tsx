import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { NewIssueForm } from "@/components/issues/issue-forms";
import { requireUser } from "@/lib/auth";
import { getMembershipBySlug } from "@/lib/data/live";

export const dynamic = "force-dynamic";

export default async function NewIssuePage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const user = await requireUser(`/w/${slug}/issues/new`);
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership) notFound();

  return (
    <>
      <PageHeader
        title="New issue"
        description="Record a customer's message so your team can track it."
        actions={
          <Link href={`/w/${slug}/issues`} className="text-sm font-medium text-brand-700 hover:underline">
            Back to issues
          </Link>
        }
      />
      <Card>
        <NewIssueForm organizationId={membership.organization.id} />
      </Card>
    </>
  );
}
