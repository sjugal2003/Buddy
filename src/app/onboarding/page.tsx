import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { CreateOrganizationForm } from "@/components/org/create-org-form";
import { requireUser } from "@/lib/auth";
import { canCreateCompany, listMyMemberships } from "@/lib/data/live";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  const [memberships, allowed] = await Promise.all([listMyMemberships(user.id), canCreateCompany()]);

  return (
    <AuthCard
      title={allowed ? "Set up your company's workspace" : "You need an invitation"}
      description={
        allowed
          ? "You'll be its owner. You can invite colleagues afterwards. If a colleague already invited you, open their invite link instead."
          : undefined
      }
      footer={
        memberships.length > 0 ? (
          <>
            Or go to{" "}
            {memberships.map((m, i) => (
              <span key={m.organization.id}>
                {i > 0 && ", "}
                <Link href={`/w/${m.organization.slug}`} className="font-medium text-brand-600 hover:underline">
                  {m.organization.name}
                </Link>
              </span>
            ))}
          </>
        ) : undefined
      }
    >
      {allowed ? (
        <CreateOrganizationForm />
      ) : (
        <div data-testid="invite-only" className="space-y-2 text-sm text-slate-600">
          <p>Buddy is invite-only for now, so this account can&apos;t create a company.</p>
          <p>Ask a company owner or admin to invite your email address, then open the link they send you.</p>
        </div>
      )}
    </AuthCard>
  );
}
