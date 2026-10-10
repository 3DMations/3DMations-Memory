// Admin-token gate shared by POST /api/sessions (minting) and
// DELETE /api/sessions/[id]. Single admin secret (AUTH_SECRET) presented
// via the X-Admin-Token header — Phase 1.6 stopgap, see .env.example.
// Constant-time compare: length early-exit leaks length only, which is
// not sensitive for a secret the operator generated at full length.
export function isAdminAuthorized(request: Request): boolean {
  const provided = request.headers.get("x-admin-token");
  const expected = process.env.AUTH_SECRET;
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}