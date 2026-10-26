import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Health page for an uptime checker (stage 38): "ok" when Buddy and its
// database both answer, "error" otherwise. It shows nothing private and needs
// no sign-in.

export const dynamic = "force-dynamic";

const DATABASE_TIMEOUT_MS = 5_000;

export async function GET() {
  let database = false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("service_health").abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
    if (error) console.error("[health]", error.code, error.message);
    database = !error && data === true;
  } catch (error) {
    console.error("[health]", error instanceof Error ? error.name : "unexpected error");
  }

  return NextResponse.json(
    { status: database ? "ok" : "error", database: database ? "ok" : "unreachable" },
    { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
