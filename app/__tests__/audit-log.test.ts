import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { BASE_URL, cleanupTestSessions, createSession } from "./helpers";

const PREFIX = "test-audit-";
let session: { id: string; token: string };

beforeAll(async () => {
  session = await createSession(`${PREFIX}primary-${Date.now()}`);
});

afterAll(async () => {
  // Clean up audit_log rows touching our test sessions BEFORE deleting them.
  await db.execute(
    sql`DELETE FROM audit_log WHERE session_id IN (SELECT id FROM sessions WHERE name LIKE ${PREFIX + "%"})`,
  );
  await cleanupTestSessions(PREFIX);
});

describe("audit_log: write paths", () => {
  it("session.create writes an audit row", async () => {
    const before = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM audit_log WHERE session_id = ${session.id} AND action = 'session.create'`,
    );
    expect(before.rows[0].count).toBeGreaterThanOrEqual(1);
  });

  it("memory.create writes an audit row referencing the new memory", async () => {
    const res = await fetch(`${BASE_URL}/api/memories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        session_id: session.id,
        title: "audit-test-memory",
        content: "verifying audit row",
      }),
    });
    expect(res.status).toBe(201);
    const memory = await res.json();

    const rows = await db.execute<{ entity_id: string; action: string }>(
      sql`SELECT entity_id::text, action FROM audit_log WHERE entity_id = ${memory.id}`,
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.rows[0].action).toBe("memory.create");
  });

  it("UPSERT replay logs memory.upsert.update", async () => {
    const localId = `audit-local-${Date.now()}`;
    const body = (title: string) => ({
      session_id: session.id,
      title,
      content: "upsert content",
      local_entry_id: localId,
    });
    const first = await fetch(`${BASE_URL}/api/memories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(body("v1")),
    });
    expect(first.status).toBe(201);
    const second = await fetch(`${BASE_URL}/api/memories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(body("v2")),
    });
    expect(second.status).toBe(201);
    const row = await second.json();

    const upsertRows = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM audit_log WHERE entity_id = ${row.id} AND action = 'memory.upsert.update'`,
    );
    expect(upsertRows.rows[0].count).toBeGreaterThanOrEqual(1);
  });
});
