import type { NextConfig } from "next";

// Baseline security headers on every route (audit 2026-10-10). CSP is set
// per-request in proxy.ts (nonce-based — see the Next.js CSP guide); these
// are the static, nonce-independent headers.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // Terminated by Tailscale Serve over TLS; harmless on internal plain HTTP.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  // Emits .next/standalone with a minimal server.js — the multi-stage
  // Dockerfile copies just that into the runner stage (no node_modules).
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;