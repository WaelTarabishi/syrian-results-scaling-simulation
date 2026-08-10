import { normalizeStudentId } from "./normalization.js";

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function importHmacKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret);
  if (cached) {
    return cached;
  }

  const imported = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  keyCache.set(secret, imported);
  return imported;
}

export async function createResultLookupKey(secret: string, studentId: string): Promise<string> {
  if (secret.length === 0) {
    throw new Error("LOOKUP_KEY_SECRET must not be empty");
  }

  const key = await importHmacKey(secret);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(normalizeStudentId(studentId)));
  const hexDigest = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `result:v1:${hexDigest}`;
}
