// Makes a new BUDDY_AI_RESULT_KEY (Phase 7 stage 36) and prints the two
// things to do with it. The key itself goes only in .env.local on the
// server; the database gets only its SHA-256 hash, so the key can't be read
// back from Supabase. Run: npm.cmd run ai-key
import { createHash, randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(key, "utf8").digest("hex");

console.log(`
1. Add this line to .env.local (keep it secret: never share it, not even with Claude):

BUDDY_AI_RESULT_KEY=${key}

2. Run this in the Supabase dashboard > SQL Editor (it holds only the hash, not the key):

update private.platform_settings set ai_result_key_hash = '${hash}', updated_at = now();

3. Restart npm.cmd run dev.
`);
