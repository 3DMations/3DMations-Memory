import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";
import {
  ADMIN_TOKEN,
  BASE_URL,
  cleanupTestSessions,
  createSession,
  deleteSession,
} from "./helpers";

const PREFIX = "test-delete-";

afterAll(async () => {
  // Belt-and-braces: clean up any lingering orphans this suite produced.
  await db.execute(
    sql`DELETE FROM memories WHERE session_id IS NULL AND title LIKE ${PREFIX + "%"}`
  );
  await cleanupTestSessions(PREFIX);
});

async function seedMemory(
  sessionId: string,
  token: string,
  title: string
): Promise<string> {
  const r = await fetch(`${BASE_URL}/api/memories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ session_id: sessionId, title }),
  });
  const data = await r.json();
  return data.id;
}

describe("DELETE /api/sessions/:id — auth", () => {
  it("rejects with 401 when no X-Admin-Token header", async () => {
    const res = await deleteSession("no-such-id");
    expect(res.status).toBe(401);
  });

  it("rejects with 401 when admin token is wrong", async () => {
    const res = await deleteSession("no-such-id", { adminToken: "wrong" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when admin token is right but session does not exist", async () => {
    const res = await deleteSession("0000nonexistent", {
      adminToken: ADMIN_TOKEN,
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/sessions/:id — keep-memories (default)", () => {
  it("deletes the session, but its memories survive with session_id=NULL", async () => {
    const s = await createSession(`${PREFIX}keep-${Date.now()}`);
    const memId = await seedMemory(s.id, s.token, `${PREFIX}keep-mem`);

    const res = await deleteSession(s.id, { adminToken: ADMIN_TOKEN });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(s.id);
    expect(data.memories_kept).toBe(1);
    expect(data.memories_deleted).toBe(0);

    const sessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, s.id));
    expect(sessionRows).toHaveLength(0);

    const memRows = await db.select().from(memories).where(eq(memories.id, memId));
    expect(memRows).toHaveLength(1);
    expect(memRows[0].sessionId).toBeNull();
  });
});

describe("DELETE /api/sessions/:id — with_memories=true (cascade)", () => {
  it("deletes the session AND all its memories", async () => {
    const s = await createSession(`${PREFIX}cascade-${Date.now()}`);
    const memId1 = await seedMemory(s.id, s.token, `${PREFIX}cascade-mem-1`);
    const memId2 = await seedMemory(s.id, s.token, `${PREFIX}cascade-mem-2`);

    const res = await deleteSession(s.id, {
      adminToken: ADMIN_TOKEN,
      withMemories: true,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(s.id);
    expect(data.memories_deleted).toBe(2);
    expect(data.memories_kept).toBe(0);

    const surviving = await db
      .select()
      .from(memories)
      .where(sql`${memories.id} IN (${memId1}, ${memId2})`);
    expect(surviving).toHaveLength(0);
  });
});
