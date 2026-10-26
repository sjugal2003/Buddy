import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { DeleteAccountForm } from "@/components/auth/delete-account-form";
import { requireUser } from "@/lib/auth";
import { getAccountDeletionPlan, type AccountDeletionOutcome } from "@/lib/data/live";

export const dynamic = "force-dynamic";

const outcomeText: Record<AccountDeletionOutcome, string> = {
  leave: "You leave it. The company and its issues stay.",
  delete: "You are its only member, so the company and all its issues are deleted too.",
  blocked_owner: "You are its only owner. Make someone else an owner first (workspace home > Members).",
  blocked_gmail: "It would be deleted, but Gmail is still connected. Disconnect Gmail first (Data sources).",
};

export default async function AccountPage() {
  const user = await requireUser("/account");
  const plan = await getAccountDeletionPlan();
  const blocked = plan.some((step) => step.outcome === "blocked_owner" || step.outcome === "blocked_gmail");
  const email = user.email ?? "";

  return (
    <AuthCard
      title="Your account"
      footer={
        plan[0] ? (
          <Link href={`/w/${plan[0].slug}`} className="font-medium text-brand-600 hover:underline">
            Back to {plan[0].name}
          </Link>
        ) : (
          <Link href="/onboarding" className="font-medium text-brand-600 hover:underline">
            Back to Buddy
          </Link>
        )
      }
    >
      <div className="space-y-6 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-slate-500">Email</dt>
          <dd className="break-all text-slate-900">{email}</dd>
        </dl>
        <p>
          <Link href="/reset-password" className="font-medium text-brand-600 hover:underline">
            Change your password
          </Link>
        </p>

        <section className="space-y-3 border-t border-slate-100 pt-4" aria-labelledby="delete-account">
          <h2 id="delete-account" className="font-medium text-slate-900">
            Delete my account
          </h2>
          <p className="text-slate-600">
            Deletes your sign-in and your name. Work you did in companies you leave stays there without your name.
            This can&rsquo;t be undone.
          </p>
          {plan.length > 0 && (
            <ul className="space-y-2" data-testid="account-deletion-plan">
              {plan.map((step) => (
                <li key={step.organizationId}>
                  <span className="font-medium text-slate-900">{step.name}:</span>{" "}
                  <span className={step.outcome.startsWith("blocked") ? "text-red-700" : "text-slate-600"}>
                    {outcomeText[step.outcome]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <DeleteAccountForm email={email} blocked={blocked} />
        </section>
      </div>
    </AuthCard>
  );
}
