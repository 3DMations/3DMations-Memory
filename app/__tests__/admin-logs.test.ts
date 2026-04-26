import { describe, expect, it } from "vitest";
import { BASE_URL } from "./helpers";

const ADMIN_LOGIN = process.env.HUB_ADMIN_LOGIN ?? "";
const skipIfNoAdmin = ADMIN_LOGIN === "";

describe("GET /api/admin/logs", () => {
  it("rejects without Tailscale-User-Login", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/logs`);
    expect([401, 500]).toContain(res.status);
  });

  it.skipIf(skipIfNoAdmin)(
    "rejects when login does not match HUB_ADMIN_LOGIN",
    async () => {
      const res = await fetch(`${BASE_URL}/api/admin/logs`, {
        headers: { "Tailscale-User-Login": "intruder@example.com" },
      });
      expect(res.status).toBe(401);
    },
  );

  it.skipIf(skipIfNoAdmin)(
    "returns recent logs for valid admin",
    async () => {
      const res = await fetch(`${BASE_URL}/api/admin/logs?limit=10`, {
        headers: { "Tailscale-User-Login": ADMIN_LOGIN },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.logs)).toBe(true);
      expect(typeof body.count).toBe("number");
      expect(body.limit).toBe(10);
    },
  );
});
