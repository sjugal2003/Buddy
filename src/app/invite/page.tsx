import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { AcceptInviteForm } from "@/components/org/members";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const user = await requireUser(`/invite?token=${encodeURIComponent(token ?? "")}`);

  if (!token) {
    return (
      <AuthCard title="Invitation link incomplete" description="Ask the person who invited you to send the link again.">
        <Link href="/" className="text-sm font-medium text-brand-600 hover:underline">
          Go to Buddy home
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Join a workspace"
      description={
        <>
          You&apos;re signed in as <span className="font-medium text-slate-700">{user.email}</span>. The invitation only
          works for the email address it was sent to.
        </>
      }
    >
      <AcceptInviteForm token={token} />
    </AuthCard>
  );
}
