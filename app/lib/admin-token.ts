import { createHash, timingSafeEqual } from "node:crypto";

// Admin-token gate shared by POST /api/sessions (minting) and
// DELETE /api/sessions/[id]. Single admin secret (AUTH_SECRET) presented
// via the X-Admin-Token header — Phase 1.6 stopgap, see .env.example.
//
// Both values are hashed before the timing-safe compare: fixed 32-byte
// digests mean no length information leaks and comparison time is
// constant regardless of input (audit 2026-10-10: the raw charCode loop
// leaked length and wasn't shared with the identity gate).
function sha256Buf(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function safeEqualString(a: string, b: string): boolean {
  return timingSafeEqual(sha256Buf(a), sha256Buf(b));
}

export function isAdminAuthorized(request: Request): boolean {
  const provided = request.headers.get("x-admin-token");
  const expected = process.env.AUTH_SECRET;
  if (!provided || !expected) return false;
  return safeEqualString(provided, expected);
}