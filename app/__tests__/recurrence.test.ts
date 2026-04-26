import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, cleanupTestSessions, createSession } from "./helpers";

const PREFIX = "test-recurrence-";
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

describe("UPSERT recurrence + GREATEST(confidence)", () => {
  it("repeated POST with same local_entry_id increments recurrence", async () => {
    const localId = `recurrence-${Date.now()}`;
    let lastRow;
    for (let i = 0; i < 3; i++) {
      const res = await postMemory({
        title: `recurrence-test-v${i + 1}`,
        content: `body ${i + 1}`,
        local_entry_id: localId,
        confidence: 0.5 + i * 0.1,
      });
      expect(res.status).toBe(201);
      lastRow = await res.json();
    }
    expect(lastRow.recurrence).toBe(3);
  });

  it("confidence is non-decreasing (GREATEST)", async () => {
    const localId = `confidence-${Date.now()}`;
    const r1 = await postMemory({
      title: "conf-test",
      content: "x",
      local_entry_id: localId,
      confidence: 0.9,
    });
    expect(r1.status).toBe(201);
    const r2 = await postMemory({
      title: "conf-test",
      content: "y",
      local_entry_id: localId,
      confidence: 0.3, // lower — should NOT replace
    });
    expect(r2.status).toBe(201);
    const row = await r2.json();
    expect(row.confidence).toBe(0.9);
    expect(row.recurrence).toBe(2);
  });
});
