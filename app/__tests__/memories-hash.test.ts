import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, cleanupTestSessions, createSession } from "./helpers";
import { computeMemoryHash } from "@/lib/hash";

const PREFIX = "test-hash-";

let session: { id: string; token: string };

beforeAll(async () => {
  session = await createSession(`${PREFIX}primary-${Date.now()}`);
});

afterAll(async () => {
  await cleanupTestSessions(PREFIX);
});

async function postMemory(
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${BASE_URL}/api/memories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ session_id: session.id, ...body }),
  });
}

describe("POST /api/memories — content_hash computation", () => {
  it("sets content_hash on a new memory and matches a recompute", async () => {
    const payload = {
      title: "hash-coverage-1",
      content: "some body text",
      category: "test",
    };
    const res = await postMemory(payload);
    expect(res.status).toBe(201);
    const row = await res.json();

    expect(typeof row.contentHash).toBe("string");
    expect(row.contentHash).toHaveLength(64); // sha256 hex

    const expected = computeMemoryHash({
      title: payload.title,
      content: payload.content,
      category: payload.category,
    });
    expect(row.contentHash).toBe(expected);
  });

  it("ignores client-supplied content_hash (server recomputes)", async () => {
    const fake = "f".repeat(64);
    const res = await postMemory({
      title: "hash-coverage-2",
      content: "another body",
      category: "test",
      content_hash: fake, // server should ignore this
    });
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.contentHash).not.toBe(fake);
    expect(row.contentHash).toBe(
      computeMemoryHash({
        title: "hash-coverage-2",
        content: "another body",
        category: "test",
      }),
    );
  });

  it("recomputes content_hash on UPSERT update path", async () => {
    const localId = `local-${Date.now()}`;
    const first = await postMemory({
      title: "v1",
      content: "first",
      category: "test",
      local_entry_id: localId,
    });
    expect(first.status).toBe(201);
    const firstRow = await first.json();

    const second = await postMemory({
      title: "v2",
      content: "second",
      category: "test",
      local_entry_id: localId,
    });
    expect(second.status).toBe(201);
    const secondRow = await second.json();

    expect(secondRow.id).toBe(firstRow.id);
    expect(secondRow.contentHash).not.toBe(firstRow.contentHash);
    expect(secondRow.contentHash).toBe(
      computeMemoryHash({
        title: "v2",
        content: "second",
        category: "test",
      }),
    );
  });
});
