import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { customAlphabet } from "nanoid";

const SESSION_ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const newSessionId = customAlphabet(SESSION_ID_ALPHABET, 12);

export function newBearerToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const HEX_RE = /^[0-9a-f]+$/i;

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  if (!HEX_RE.test(a) || !HEX_RE.test(b)) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
