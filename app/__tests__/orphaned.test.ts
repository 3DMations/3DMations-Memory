import { isNull, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { memories } from "@/db/schema";
import {
  ADMIN_TOKEN,
  BASE_URL,
  cleanupTestSessions,
  createSession,
  deleteSession,
} from "./helpers";

const PREFIX = "test-orphan-";

afterAll(async () => {
  await db.execute(
    sql`DELETE FROM memories WHERE session_id IS NULL AND title LIKE ${PREFIX + "%"}`
  );
  await cleanupTestSessions(PREFIX);
});

describe("/orphaned page — memories with NULL session_id", () => {
  it("after a keep-memories delete, the orphaned page shows the surviving memory", async () => {
    const s = await createSession(`${PREFIX}sess-${Date.now()}`);
    await fetch(`${BASE_URL}/api/memories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s.token}`,
      },
      body: JSON.stringify({
        session_id: s.id,
        title: `${PREFIX}orphan-bound-mem`,
      }),
    });

    const del = await deleteSession(s.id, { adminToken: ADMIN_TOKEN });
    expect(del.status).toBe(200);

    const orphanRows = await db
      .select()
      .from(memories)
      .where(isNull(memories.sessionId));

    const titles = orphanRows.map((m) => m.title);
    expect(titles).toContain(`${PREFIX}orphan-bound-mem`);

    const res = await fetch(`${BASE_URL}/orphaned`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`${PREFIX}orphan-bound-mem`);
  });
});
