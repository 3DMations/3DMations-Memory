import { describe, expect, it } from "vitest";
import { safeEqualHex, sha256 } from "@/lib/crypto";

describe("crypto helpers", () => {
  it("sha256 is stable and produces 64-char hex", () => {
    const a = sha256("hello");
    const b = sha256("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("hello")).not.toBe(sha256("hello "));
  });

  it("safeEqualHex returns true for identical hex and false otherwise", () => {
    const h = sha256("token-x");
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, sha256("token-y"))).toBe(false);
    expect(safeEqualHex(h, h.slice(0, 60))).toBe(false);
    expect(safeEqualHex("zz", "zz")).toBe(false);
  });
});
