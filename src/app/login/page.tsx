import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard, FormMessage } from "@/components/auth/auth-card";
import { SignInForm } from "@/components/auth/auth-forms";
import { getCurrentUser, safeNextPath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; deleted?: string }>;
}) {
  const { next, error, deleted } = await searchParams;
  const nextPath = safeNextPath(next);
  if (await getCurrentUser()) redirect(nextPath);

  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          New to Buddy?{" "}
          <Link href="/signup" className="font-medium text-brand-600 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {error === "confirm" && (
        <div className="mb-4">
          <FormMessage error="That confirmation link is invalid or has expired. Try signing in. If your email is not confirmed yet, sign up again with the same details to get a new link." />
        </div>
      )}
      {deleted === "1" && (
        <div className="mb-4">
          <FormMessage success="Your account has been deleted." />
        </div>
      )}
      <SignInForm next={nextPath} />
    </AuthCard>
  );
}
