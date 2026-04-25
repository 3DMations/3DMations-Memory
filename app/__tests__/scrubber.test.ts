import { describe, expect, it } from "vitest";
import {
  scrub,
  scrubPayload,
  ScrubberError,
} from "../../.claude/skills/hub-scrubber/scrubber";
import { PATTERNS } from "../../.claude/skills/hub-scrubber/patterns";

const SAMPLES: Record<string, string> = {
  "github-pat": "ghp_" + "a".repeat(40),
  "aws-access-key": "AKIAABCDEFGHIJKLMNOP",
  "slack-token": "xoxb-12345-67890-abcdef",
  "anthropic-key": "sk-ant-" + "a".repeat(95),
  "openai-key": "sk-" + "a".repeat(40),
  "google-api-key": "AIza" + "a".repeat(35),
  "tailscale-auth-key": "tskey-auth-kvtJAbR1ABC2DEF3",
  "private-key-pem": "-----BEGIN RSA PRIVATE KEY-----",
  "bearer-token": "Bearer " + "a".repeat(40),
  "password-assignment": "password=hunter2supersecret",
  "secret-assignment": "secret: my-very-real-secret",
  "long-token": "a".repeat(80),
};

describe("hub-scrubber: positive matches", () => {
  for (const p of PATTERNS) {
    it(`throws on ${p.name}`, () => {
      const sample = SAMPLES[p.name];
      expect(sample, `missing sample for ${p.name}`).toBeDefined();
      expect(() => scrub(sample)).toThrowError(ScrubberError);
    });
  }
});

describe("hub-scrubber: false-positive guards", () => {
  it("does NOT trip on a 40-char git SHA", () => {
    const gitSha = "1234567890abcdef1234567890abcdef12345678";
    expect(gitSha.length).toBe(40);
    expect(() => scrub(gitSha)).not.toThrow();
  });

  it("does NOT trip on a 36-char UUID", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(uuid.length).toBe(36);
    expect(() => scrub(uuid)).not.toThrow();
  });

  it("does NOT trip on plain prose without secrets", () => {
    expect(() =>
      scrub("Refactored the auth middleware and added integration tests."),
    ).not.toThrow();
  });
});

describe("hub-scrubber: multi-line PEM detection", () => {
  it("trips on a multi-line PEM block", () => {
    const pem = [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAA",
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");
    expect(() => scrub(pem)).toThrowError(ScrubberError);
  });
});

describe("hub-scrubber: payload helper", () => {
  it("scrubs all string fields and reports the offending field", () => {
    try {
      scrubPayload({
        title: "fine",
        content: "ghp_" + "z".repeat(40),
        tags: ["also fine"],
      });
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ScrubberError);
      expect((e as ScrubberError).field).toBe("content");
      expect((e as ScrubberError).patternName).toBe("github-pat");
    }
  });

  it("ignores non-string values", () => {
    expect(() =>
      scrubPayload({ count: 5, nested: { ignored: true } }),
    ).not.toThrow();
  });
});
