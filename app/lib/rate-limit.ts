// In-memory fixed-window rate limiter. Single-instance app, so a plain Map
// is enough — no shared state across replicas. Best-effort DoS damping for
// unauthenticated expensive endpoints; the DB-level statement_timeout is the
// hard backstop (db/index.ts).
//
// Keying: Tailscale Serve sets X-Forwarded-For to the tailnet client IP.
// Loopback/direct callers have no header → bucketed as "local".

const WINDOW_MS = 60_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function clientIpFrom(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return "local";
}

// No/loopback X-Forwarded-For means the call originated inside the netns
// (make session, test stack, the app itself — Next.js stamps XFF with the
// peer address on internal requests). After the P0 loopback bind, remote
// containers cannot reach :3000, and Tailscale Serve overwrites XFF with the
// real tailnet client IP for external traffic — so a loopback XFF here is
// always genuinely internal. Exempting it keeps the limiter aimed at
// tailnet-origin traffic.
const LOCAL_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "local"]);

export function rateLimit(
  request: Request,
  scope: string,
  limit: number
): { ok: boolean; retryAfterSec: number } {
  if (LOCAL_IPS.has(clientIpFrom(request))) {
    return { ok: true, retryAfterSec: 0 };
  }

  const key = `${scope}:${clientIpFrom(request)}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, retryAfterSec: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { ok: true, retryAfterSec: 0 };
}

export function tooManyRequests(retryAfterSec: number): Response {
  return Response.json(
    { error: "rate limited, retry later" },
    { status: 429, headers: { "retry-after": String(retryAfterSec) } }
  );
}

export function limitHeaders(
  request: Request,
  scope: string,
  limit: number
): Response | null {
  const result = rateLimit(request, scope, limit);
  return result.ok ? null : tooManyRequests(result.retryAfterSec);
}

// Bound map growth: drop expired buckets when the map gets large.
export function pruneBuckets(maxKeys = 10_000): void {
  if (buckets.size <= maxKeys) return;
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}