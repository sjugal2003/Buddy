import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { CreateOrganizationForm } from "@/components/org/create-org-form";
import { requireUser } from "@/lib/auth";
import { listMyMemberships } from "@/lib/data/live";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  const memberships = await listMyMemberships(user.id);

  return (
    <AuthCard
      title="Set up your company's workspace"
      description="You'll be its owner. You can invite colleagues afterwards. If a colleague already invited you, open their invite link instead."
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
      <CreateOrganizationForm />
    </AuthCard>
  );
}
