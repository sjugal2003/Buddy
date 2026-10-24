import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encrypts the Gmail sign-in token before it is stored, with AES-256-GCM and a
// key that only the server has (GMAIL_TOKEN_KEY). The database only ever sees
// "v1:<iv>:<tag>:<ciphertext>", which is useless without the key.

const PREFIX = "v1";

/** The key from a base64 value of exactly 32 bytes, or null when it is missing or wrong. */
export function parseTokenKey(value: string | undefined): Buffer | null {
  if (!value?.trim()) return null;
  try {
    const key = Buffer.from(value.trim(), "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function encryptToken(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

/** The token, or null when the value was not made with this key (or was changed). */
export function decryptToken(stored: string, key: Buffer): string | null {
  const [prefix, iv, tag, ciphertext] = stored.split(":");
  if (prefix !== PREFIX || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
