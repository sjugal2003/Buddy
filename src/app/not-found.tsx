import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-slate-500">That page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/" className="text-sm font-medium text-brand-600 hover:underline">
        Go to Buddy home
      </Link>
    </div>
  );
}
