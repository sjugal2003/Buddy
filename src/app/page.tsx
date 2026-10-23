import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { primaryButton, secondaryButton } from "@/components/ui/form";
import { getCurrentUser } from "@/lib/auth";
import { listMyMemberships } from "@/lib/data/live";
import { listWorkspaces } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) {
    const [first] = await listMyMemberships(user.id);
    redirect(first ? `/w/${first.organization.slug}` : "/onboarding");
  }

  const demos = await listWorkspaces();
  const configured = isSupabaseConfigured();

  return (
    <AuthCard
      title="Welcome to Buddy"
      description="Understand customer feedback, route issues to the right team and track them to resolution."
    >
      <div className="space-y-3">
        {configured ? (
          <>
            <Link href="/login" className={`${primaryButton} w-full`}>
              Sign in
            </Link>
            <Link href="/signup" className={`${secondaryButton} w-full`}>
              Create an account
            </Link>
          </>
        ) : (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Sign-in is not set up on this computer yet, so only the demo is available. See the README to connect
            Supabase.
          </p>
        )}
        <div className="border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Or explore the demo</p>
          <ul className="space-y-2">
            {demos.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/demo/${w.slug}`}
                  className="block rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-900">{w.name}</span>
                  <span className="block text-xs text-slate-500">Fictional company · {w.industry}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AuthCard>
  );
}
