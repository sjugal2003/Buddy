import "server-only";

interface DatabaseError {
  code?: string;
  message?: string;
}

// Error codes raised on purpose by Buddy's own database functions. Their
// messages are written for people, so they can be shown as they are.
const FRIENDLY_CODES = new Set(["P0001", "P0002", "22023"]);

/**
 * Turns a database error into a message that is safe to show: Buddy's own
 * messages pass through, anything technical becomes the fallback. The full
 * error is logged on the server only.
 */
export function friendlyError(error: DatabaseError, fallback: string, context: string) {
  console.error(`[${context}]`, error.code, error.message);
  const message = error.message ?? "";
  if (FRIENDLY_CODES.has(error.code ?? "")) return message;
  if (error.code === "42501") {
    // Our functions use this code with plain sentences; Postgres uses it for
    // technical permission errors, which should not be shown.
    if (message && !/row-level security|permission denied/i.test(message)) return message;
    return "You don't have permission to do that.";
  }
  return fallback;
}
