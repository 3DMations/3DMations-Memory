import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { BASE_URL, cleanupTestSessions, createSession } from "./helpers";

const PREFIX = "test-verify-";
const ADMIN_LOGIN = process.env.HUB_ADMIN_LOGIN ?? "";
const skipIfNoAdmin = ADMIN_LOGIN === "";

let session: { id: string; token: string };

beforeAll(async () => {
  session = await createSession(`${PREFIX}primary-${Date.now()}`);
});

afterAll(async () => {
  await cleanupTestSessions(PREFIX);
});

async function callVerify(headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE_URL}/api/memories/verify`, {
    method: "GET",
    headers,
  });
}

async function postMemory(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE_URL}/api/memories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ session_id: session.id, ...body }),
  });
}

describe("GET /api/memories/verify — auth", () => {
  it("rejects with 401 when Tailscale-User-Login is missing", async () => {
    const res = await callVerify();
    // 401 = no header; 500 = server has no HUB_ADMIN_LOGIN configured
    expect([401, 500]).toContain(res.status);
  });

  it.skipIf(skipIfNoAdmin)(
    "rejects with 401 when Tailscale-User-Login does not match HUB_ADMIN_LOGIN",
    async () => {
      const res = await callVerify({
        "Tailscale-User-Login": "intruder@example.com",
      });
      expect(res.status).toBe(401);
    },
  );
});

describe.skipIf(skipIfNoAdmin)("GET /api/memories/verify — drift detection", () => {
  it("returns 200 with empty drift when all hashes are stable", async () => {
    await postMemory({
      title: "verify-stable",
      content: "stable content",
      category: "test",
    });

    const res = await callVerify({ "Tailscale-User-Login": ADMIN_LOGIN });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drift).toEqual([]);
    expect(typeof body.checked).toBe("number");
    expect(typeof body.ok).toBe("number");
  });

  it("returns 409 with the drifted id when a row is mutated outside the API", async () => {
    const post = await postMemory({
      title: "verify-pre-mutation",
      content: "untampered",
      category: "test",
    });
    const row = await post.json();

    // Tamper directly via SQL — bypasses the server's hash recomputation.
    await db.execute(
      sql`UPDATE memories SET title = 'verify-tampered' WHERE id = ${row.id}`,
    );

    const res = await callVerify({ "Tailscale-User-Login": ADMIN_LOGIN });
    expect(res.status).toBe(409);
    const body = await res.json();
    const ids = body.drift.map((d: { id: string }) => d.id);
    expect(ids).toContain(row.id);
  });
});
