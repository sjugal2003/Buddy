import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";

/**
 * A Supabase client that acts as the signed-in user (from their session
 * cookie). Every query it makes is checked by the database's Row Level
 * Security rules, so it can only reach that user's organisations.
 */
export async function createClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase is not configured.");
  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server components cannot set cookies. The middleware refreshes
          // the session cookie on every request, so this is safe to ignore.
        }
      },
    },
  });
}
