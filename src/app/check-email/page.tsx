import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";

export default function CheckEmailPage() {
  return (
    <AuthCard
      title="Check your email"
      description="If this address can be used, we've sent a confirmation link to it. Open the link to finish signing up."
      footer={
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <p className="text-sm text-slate-600">
        Nothing arrived after a few minutes? Check your spam folder. The test email service allows only a few emails per
        hour, so wait a while before trying again.
      </p>
    </AuthCard>
  );
}
