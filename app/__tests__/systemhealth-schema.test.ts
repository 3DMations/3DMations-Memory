// Phase 6 — verify the system_metrics table + index were applied to the DB.
// Belt-and-suspenders against drift between schema.ts, post-push-init.sql,
// and the actual running DB.

import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { sql } from "drizzle-orm";

describe("system_metrics schema", () => {
  it("table exists with expected columns", async () => {
    const cols = await db.execute<{ column_name: string; data_type: string }>(
      sql`
        SELECT column_name, data_type
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'system_metrics'
      `,
    );
    const map = new Map(cols.rows.map((c) => [c.column_name, c.data_type]));
    expect(map.get("id")).toBe("bigint");
    expect(map.get("recorded_at")).toBe("timestamp with time zone");
    expect(map.get("metric")).toBe("text");
    expect(map.get("value")).toBe("double precision");
    expect(map.get("metadata")).toBe("jsonb");
  });

  it("(metric, recorded_at) index exists", async () => {
    const idx = await db.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'system_metrics'
         AND indexname = 'idx_metrics_metric_time'
    `);
    expect(idx.rows.length).toBe(1);
  });

  it("schema_version row 2 was inserted", async () => {
    const row = await db.execute<{ version: number; description: string }>(sql`
      SELECT version, description FROM schema_version WHERE version = 2
    `);
    expect(row.rows[0]?.version).toBe(2);
    expect(row.rows[0]?.description).toMatch(/system_metrics/);
  });
});
