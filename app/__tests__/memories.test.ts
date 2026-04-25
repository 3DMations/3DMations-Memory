import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, cleanupTestSessions, createSession } from "./helpers";

const PREFIX = "test-memories-";

let session: { id: string; token: string };
let otherSession: { id: string; token: string };

beforeAll(async () => {
  session = await createSession(`${PREFIX}primary-${Date.now()}`);
  otherSession = await createSession(`${PREFIX}other-${Date.now()}`);
});

afterAll(async () => {
  await cleanupTestSessions(PREFIX);
});

async function postMemory(
  body: Record<string, unknown>,
  token?: string
): Promise<Response> {
  return fetch(`${BASE_URL}/api/memories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/memories — auth", () => {
  it("rejects with 401 when no bearer token", async () => {
    const res = await postMemory({ session_id: session.id, title: "x" });
    expect(res.status).toBe(401);
  });

  it("rejects with 401 when bearer token is invalid", async () => {
    const res = await postMemory(
      { session_id: session.id, title: "x" },
      "not-a-real-token"
    );
    expect(res.status).toBe(401);
  });

  it("rejects with 403 when token belongs to a different session", async () => {
    const res = await postMemory(
      { session_id: session.id, title: "x" },
      otherSession.token
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/memories — write", () => {
  it("creates a memory with 201 and returns a uuidv7", async () => {
    const res = await postMemory(
      {
        session_id: session.id,
        title: "first memory",
        category: "test",
        tags: ["alpha", "beta"],
      },
      session.token
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(data.sessionId).toBe(session.id);
    expect(data.title).toBe("first memory");
    expect(data.tags).toEqual(["alpha", "beta"]);
  });

  it("upserts on (session_id, local_entry_id) — same key returns same id, content updates", async () => {
    const localId = `local-${Date.now()}`;
    const r1 = await postMemory(
      {
        session_id: session.id,
        title: "upsert v1",
        local_entry_id: localId,
        content: "first",
      },
      session.token
    );
    const r2 = await postMemory(
      {
        session_id: session.id,
        title: "upsert v2",
        local_entry_id: localId,
        content: "second",
      },
      session.token
    );
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const a = await r1.json();
    const b = await r2.json();
    expect(b.id).toBe(a.id);
    expect(b.title).toBe("upsert v2");
    expect(b.content).toBe("second");
  });
});

describe("GET /api/memories", () => {
  it("lists memories scoped to the session (recent first)", async () => {
    const res = await fetch(
      `${BASE_URL}/api/memories?session=${session.id}`,
      { headers: { Authorization: `Bearer ${session.token}` } }
    );
    expect(res.status).toBe(200);
    const { memories } = await res.json();
    expect(Array.isArray(memories)).toBe(true);
    expect(memories.length).toBeGreaterThan(0);
    expect(memories.every((m: { sessionId: string }) => m.sessionId === session.id)).toBe(true);
  });

  it("ranks results by trigram similarity when ?q= is set", async () => {
    await postMemory(
      {
        session_id: session.id,
        title: "PostgreSQL trigram performance notes",
        content: "GIN indexes accelerate similarity search",
      },
      session.token
    );
    await postMemory(
      {
        session_id: session.id,
        title: "Unrelated topic",
        content: "Nothing about databases here",
      },
      session.token
    );
    const res = await fetch(
      `${BASE_URL}/api/memories?session=${session.id}&q=trigram`,
      { headers: { Authorization: `Bearer ${session.token}` } }
    );
    expect(res.status).toBe(200);
    const { memories } = await res.json();
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0].title).toContain("trigram");
  });
});
