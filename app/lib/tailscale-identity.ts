// Tailscale identity gate.
//
// When Tailscale Serve proxies a request (Funnel disabled), it injects:
//   Tailscale-User-Login   — e.g. "alice@example.com"
//   Tailscale-User-Name    — display name
//   Tailscale-User-Profile-Pic
//
// Headers are spoof-safe for traffic that transits Serve: it strips any
// inbound copies before forwarding. Verified against Tailscale KB 1312/serve,
// validated 2026-01-20. The primary control keeping non-Serve traffic away
// from this app is the loopback bind (docker-compose.yml) — with -H 127.0.0.1
// nothing outside the netns can reach the socket, so header spoofing requires
// already being inside the trusted netns. Do not re-expose the port.
//
// CAVEAT: tagged devices do NOT get user-identity headers populated.
// The ts-hub container itself runs under tag:hub, so any callback originating
// from inside the netns will be rejected. This is intentional — /verify is
// for interactive admin use from a logged-in tailnet machine.
//
// LOOPBACK: O4 resolved (a) — the debug profile bypasses Serve entirely,
// so headers are absent. requireAdmin rejects without exception. To run
// /verify, fix the tailnet path; do not couple auth to network position.

import { safeEqualString } from "./admin-token";

export type AdminCheck =
  | { ok: true; login: string }
  | { ok: false; status: 401 | 500; error: string };

export function requireAdmin(request: Request): AdminCheck {
  const expected = process.env.HUB_ADMIN_LOGIN;
  if (!expected) {
    return {
      ok: false,
      status: 500,
      error: "HUB_ADMIN_LOGIN not configured on server",
    };
  }
  const login = request.headers.get("tailscale-user-login");
  if (!login) {
    return {
      ok: false,
      status: 401,
      error: "tailscale identity required",
    };
  }
  // Case-insensitive: GitHub SSO preserves user-handle casing
  // (e.g., "3DMations@github") but operators commonly normalize to lowercase
  // when copying into .env. Identities are conventionally case-insensitive.
  // Compare is timing-safe via hashed digests (audit 2026-10-10).
  if (!safeEqualString(login.toLowerCase(), expected.toLowerCase())) {
    return {
      ok: false,
      status: 401,
      error: "not authorized",
    };
  }
  return { ok: true, login };
}
