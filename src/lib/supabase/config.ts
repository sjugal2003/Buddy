// Supabase connection settings. Both values are public by design: the
// publishable key only allows what the database's security rules allow.
// The secret key is never used by this app and must never be added here.

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

export function getSupabaseConfig(): SupabaseConfig | null {
  // Written out in full so Next.js can include them in browser code.
  const url = projectOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

/**
 * Keeps only `https://<ref>.supabase.co`. A URL copied with extra path such as
 * `/rest/v1/` makes every sign-in call fail with "Invalid path specified".
 */
function projectOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim()).origin;
  } catch {
    console.error("[supabase] NEXT_PUBLIC_SUPABASE_URL is not a valid web address");
    return null;
  }
}

export function isSupabaseConfigured() {
  return getSupabaseConfig() !== null;
}
