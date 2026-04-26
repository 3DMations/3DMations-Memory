import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, cleanupTestSessions, createSession } from "./helpers";

const PREFIX = "test-gotchas-";
let session: { id: string; token: string };

beforeAll(async () => {
  session = await createSession(`${PREFIX}primary-${Date.now()}`);
});

afterAll(async () => {
  await cleanupTestSessions(PREFIX);
});

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

describe("GET /api/memories/gotchas", () => {
  it("returns shape with high_recurrence + cross_session keys", async () => {
    const res = await fetch(`${BASE_URL}/api/memories/gotchas?min=3`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("threshold", 3);
    expect(Array.isArray(body.high_recurrence)).toBe(true);
    expect(Array.isArray(body.cross_session)).toBe(true);
  });

  it("entry hits high_recurrence after 3 UPSERT replays", async () => {
    const localId = `gotcha-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      const r = await postMemory({
        title: "gotcha-replay-test",
        content: "body",
        local_entry_id: localId,
      });
      expect(r.status).toBe(201);
    }
    const res = await fetch(`${BASE_URL}/api/memories/gotchas?min=3`);
    const body = await res.json();
    const titles = body.high_recurrence.map((m: { title: string }) => m.title);
    expect(titles).toContain("gotcha-replay-test");
  });
});
