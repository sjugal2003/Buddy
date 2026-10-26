import { AuthCard } from "@/components/auth/auth-card";
import { NewPasswordForm } from "@/components/auth/auth-forms";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// The reset link from the email signs the person in once and lands here.
export default async function ResetPasswordPage() {
  await requireUser("/reset-password");
  return (
    <AuthCard title="Choose a new password">
      <NewPasswordForm />
    </AuthCard>
  );
}
