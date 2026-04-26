import { NextRequest, NextResponse } from "next/server";

// Structured request log per /api/* call. Output is single-line JSON to
// stdout, easy to grep / pipe to log aggregators later. Latency is measured
// inside this proxy only — downstream route timing is covered by Next.js
// request logs already (the "GET / 200 in 42ms" lines).
//
// Renamed from middleware → proxy in Next.js 16.

export function proxy(request: NextRequest) {
  const start = performance.now();
  // Re-use an upstream X-Request-ID if present; otherwise generate one.
  // crypto.randomUUID is widely available in the Edge runtime.
  const requestId =
    request.headers.get("x-request-id") ?? crypto.randomUUID();

  const response = NextResponse.next();
  response.headers.set("x-request-id", requestId);

  // Don't await — fire-and-forget log on response close.
  const url = new URL(request.url);
  const log = {
    ts: new Date().toISOString(),
    request_id: requestId,
    method: request.method,
    path: url.pathname,
    query: url.search || undefined,
    actor: request.headers.get("tailscale-user-login") || undefined,
    duration_ms: Math.round(performance.now() - start),
  };
  // Single-line JSON for ingestion friendliness.
  console.log(`[req] ${JSON.stringify(log)}`);

  return response;
}

// Only run for API routes — page renders already log via Next dev/start.
export const config = {
  matcher: "/api/:path*",
};
