// The rules behind `npm run check-env` (scripts/check-env.mjs, stage 39).
// Kept apart so unit tests can check them. Nothing here ever returns a
// setting's value: only its name, "set" or "missing", and what to fix.

/** Settings that may be seen by every browser. Any other NEXT_PUBLIC_ name is a mistake. */
export const BROWSER_SAFE = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];

/** Every setting Buddy reads, in the order they are listed. */
export const SETTINGS = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", group: "Supabase", secret: false, required: true },
  { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", group: "Supabase", secret: false, required: true },
  { name: "BUDDY_SITE_URL", group: "Web address", secret: false, required: false },
  { name: "BUDDY_AI_RESULT_KEY", group: "AI", secret: true, required: false },
  { name: "GEMINI_API_KEY", group: "AI", secret: true, required: false },
  { name: "ANTHROPIC_API_KEY", group: "AI", secret: true, required: false },
  { name: "GOOGLE_CLIENT_ID", group: "Gmail", secret: true, required: false },
  { name: "GOOGLE_CLIENT_SECRET", group: "Gmail", secret: true, required: false },
  { name: "GMAIL_TOKEN_KEY", group: "Gmail", secret: true, required: false },
  { name: "BUDDY_PLAY_REAL", group: "Google Play", secret: false, required: false },
  { name: "BUDDY_AI_MODE", group: "Tests only", secret: false, required: false },
  { name: "BUDDY_GMAIL_MODE", group: "Tests only", secret: false, required: false },
  { name: "BUDDY_PLAY_MODE", group: "Tests only", secret: false, required: false },
];

const has = (vars, name) => Boolean(vars[name]?.trim());

/** A Supabase secret key, or an old-style service_role key, whatever its name. */
function looksLikeSecretSupabaseKey(value) {
  const v = value.trim();
  if (v.startsWith("sb_secret_")) return true;
  const parts = v.split(".");
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role";
  } catch {
    return false;
  }
}

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Checks a set of settings. `live` means "as a live server would run it".
 * Returns one row per known setting plus the problems (errors stop a launch,
 * warnings are worth a look). Values are only inspected, never returned.
 */
export function checkEnv(vars, { live = false } = {}) {
  const errors = [];
  const warnings = [];

  const rows = SETTINGS.map(({ name, group, secret }) => ({ name, group, secret, set: has(vars, name) }));

  for (const { name, required } of SETTINGS) {
    if (required && !has(vars, name)) errors.push(`${name} is missing. Buddy can't reach Supabase without it.`);
  }

  for (const [name, value] of Object.entries(vars)) {
    if (!value?.trim()) continue;
    if (name.startsWith("NEXT_PUBLIC_") && !BROWSER_SAFE.includes(name)) {
      errors.push(`${name}: names starting with NEXT_PUBLIC_ are sent to every visitor's browser. Buddy never needs one besides the two Supabase ones, so remove it (if it holds a key, treat that key as leaked: docs/RUNBOOK.md section 7).`);
    }
    if (looksLikeSecretSupabaseKey(value)) {
      errors.push(`${name} holds a Supabase secret (service role) key. Buddy never uses one: remove it, and treat the key as leaked (docs/RUNBOOK.md section 7).`);
    }
  }

  const site = vars.BUDDY_SITE_URL?.trim();
  let siteUrl = null;
  if (site) {
    try {
      siteUrl = new URL(site);
      if (!["http:", "https:"].includes(siteUrl.protocol) || siteUrl.username || siteUrl.password || siteUrl.search || siteUrl.hash) siteUrl = null;
    } catch {
      siteUrl = null;
    }
    if (!siteUrl) errors.push("BUDDY_SITE_URL is not a plain web address like https://buddy.example.com.");
  }
  if (live) {
    if (!site) errors.push("BUDDY_SITE_URL is missing. A live server needs it for sign-up emails, invitations and Gmail.");
    else if (siteUrl && siteUrl.protocol !== "https:") errors.push("BUDDY_SITE_URL must start with https:// on a live server.");
    else if (siteUrl && isLocalhost(siteUrl.hostname)) errors.push("BUDDY_SITE_URL points at this computer (localhost). Use the live address.");
    for (const name of ["BUDDY_AI_MODE", "BUDDY_GMAIL_MODE", "BUDDY_PLAY_MODE"]) {
      if (has(vars, name)) errors.push(`${name} is for automated tests only. Remove it from the live server.`);
    }
  } else {
    for (const name of ["BUDDY_AI_MODE", "BUDDY_GMAIL_MODE", "BUDDY_PLAY_MODE"]) {
      if (has(vars, name)) warnings.push(`${name} is set, so Buddy uses a pretend service on this computer. Remove it unless you are running tests.`);
    }
  }

  const aiKey = vars.BUDDY_AI_RESULT_KEY?.trim() ?? "";
  const aiProvider = has(vars, "GEMINI_API_KEY") || has(vars, "ANTHROPIC_API_KEY");
  if (aiProvider && !aiKey) warnings.push("An AI key is set but BUDDY_AI_RESULT_KEY is missing, so AI shows as not set up. Make one with npm.cmd run ai-key.");
  if (aiKey && aiKey.length < 32) warnings.push("BUDDY_AI_RESULT_KEY is too short, so AI shows as not set up. Make a new one with npm.cmd run ai-key.");
  if (aiKey && !aiProvider) warnings.push("BUDDY_AI_RESULT_KEY is set but there is no GEMINI_API_KEY or ANTHROPIC_API_KEY, so AI shows as not set up.");

  const gmail = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GMAIL_TOKEN_KEY"];
  const gmailSet = gmail.filter((name) => has(vars, name));
  if (gmailSet.length > 0 && gmailSet.length < gmail.length) {
    const missing = gmail.filter((name) => !has(vars, name)).join(", ");
    warnings.push(`Gmail needs all three settings; missing: ${missing}. Until then Gmail shows as not set up.`);
  }
  const tokenKey = vars.GMAIL_TOKEN_KEY?.trim();
  if (tokenKey && Buffer.from(tokenKey, "base64").length !== 32) {
    warnings.push("GMAIL_TOKEN_KEY is not 32 random bytes in base64, so Gmail shows as not set up (see the README for the command that makes one).");
  }

  const playReal = vars.BUDDY_PLAY_REAL?.trim();
  if (playReal && playReal !== "on") warnings.push('BUDDY_PLAY_REAL only does something when it is exactly "on". Remove it otherwise.');
  if (playReal === "on") {
    warnings.push("BUDDY_PLAY_REAL is on, so owners can connect a real Google Play app and bring in real customer reviews. Only keep it once real data is approved.");
    if (!tokenKey || Buffer.from(tokenKey, "base64").length !== 32) {
      warnings.push("BUDDY_PLAY_REAL is on but GMAIL_TOKEN_KEY is missing or wrong, so Google Play stays off (it uses the same key).");
    }
  }

  return { rows, errors, warnings };
}

/** Reads KEY=value lines from a .env file's text; skips comments and blank lines. */
export function parseEnvFile(text) {
  const vars = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    vars[match[1]] = value;
  }
  return vars;
}
