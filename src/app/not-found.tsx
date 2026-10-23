import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-slate-500">That workspace or page doesn&apos;t exist in this demo.</p>
      <Link href="/" className="text-sm font-medium text-brand-600 hover:underline">
        Go to the dashboard
      </Link>
    </div>
  );
}
