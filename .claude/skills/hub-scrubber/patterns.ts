// Credential / secret shapes the scrubber rejects.
// Order: most-specific first, catch-all last (matches first hit).
//
// Original 8 from .archive/api/scrubber.py (v3.3, retired 2026-04).
// Additions 9-12 from Phase 3b (2026-04-25).

export interface Pattern {
  name: string;
  regex: RegExp;
}

export const PATTERNS: readonly Pattern[] = [
  { name: "github-pat", regex: /ghp_[a-zA-Z0-9]{36,}/ },
  { name: "aws-access-key", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "slack-token", regex: /xox[bps]-[a-zA-Z0-9-]+/ },
  { name: "anthropic-key", regex: /sk-ant-[a-zA-Z0-9_-]{90,}/ },
  { name: "openai-key", regex: /sk-[a-zA-Z0-9]{20,}/ },
  { name: "google-api-key", regex: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "tailscale-auth-key", regex: /tskey-(auth|client|api)-[a-zA-Z0-9]+/ },
  // No `s` flag needed — pattern has no `.` metachars, just literal text + char class.
  { name: "private-key-pem", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "bearer-token", regex: /Bearer\s+[a-zA-Z0-9._~+/-]{20,}/i },
  { name: "password-assignment", regex: /password\s*[:=]\s*\S+/i },
  { name: "secret-assignment", regex: /secret\s*[:=]\s*\S+/i },
  { name: "long-token", regex: /[A-Za-z0-9_-]{64,}/ },
] as const;
