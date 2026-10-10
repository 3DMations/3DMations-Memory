import { NextRequest, NextResponse } from "next/server";

// Two jobs:
//
// 1. Structured request log per /api/* call. Output is single-line JSON to
//    stdout, easy to grep / pipe to log aggregators later. Latency is measured
//    inside this proxy only — downstream route timing is covered by Next.js
//    request logs already (the "GET / 200 in 42ms" lines).
//
// 2. Per-request nonce + Content-Security-Policy (Next.js CSP guide, proxy
//    pattern). Pages read the nonce via headers() and stamp it on the theme
//    bootstrap script; Next.js automatically nonces its own inline scripts
//    when it sees the CSP header on the request. Only /api/* is logged —
//    CSP applies to everything.
//
// Renamed from middleware → proxy in Next.js 16.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'unsafe-inline';
    img-src 'self' data:;
    font-src 'self';
    connect-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
`;
  return cspHeader.replace(/\s{2,}/g, " ").trim();
}

export function proxy(request: NextRequest) {
  const start = performance.now();

  // Re-use an upstream X-Request-ID if it's a valid UUID; otherwise generate
  // one. (audit 2026-10-10: client-supplied x-request-id used to be echoed
  // verbatim into logs and the audit trail, letting callers forge correlation
  // IDs. Malformed values are ignored, not trusted.)
  const upstreamId = request.headers.get("x-request-id");
  const requestId =
    upstreamId && UUID_RE.test(upstreamId) ? upstreamId : crypto.randomUUID();

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  response.headers.set("Content-Security-Policy", csp);

  const url = new URL(request.url);
  if (url.pathname.startsWith("/api")) {
    // Don't await — fire-and-forget log on response close.
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
  }

  return response;
}

// API routes (logging + CSP) and every document render (CSP nonce for the
// theme script). _next static/image assets and the favicons skip the proxy.
export const config = {
  matcher: [
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};