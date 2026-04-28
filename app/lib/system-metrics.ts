// Phase 6 — system metric collector. Pure function; no side effects.
// Called once at boot + every 5 min by instrumentation-node.ts. Also called
// directly by __tests__/systemhealth-collect.test.ts.

import { db } from "@/db";
import { systemMetrics } from "@/db/schema";
import { sql } from "drizzle-orm";
import { readFile, statfs } from "node:fs/promises";

export const COLLECT_INTERVAL_MS = 5 * 60 * 1000;
export const LOG_PREFIX = "[systemhealth]";

// Parses a "key value\nkey value\n..." file (e.g. cgroup memory.events)
// into a Map<string, number>. Missing/unparseable values become NaN.
async function readKvFile(path: string): Promise<Map<string, number>> {
  const txt = await readFile(path, "utf8");
  const m = new Map<string, number>();
  for (const line of txt.split("\n")) {
    const [k, v] = line.split(/\s+/);
    if (k && v !== undefined) m.set(k, Number(v));
  }
  return m;
}

export async function collectSamples(): Promise<
  { metric: string; value: number }[]
> {
  const samples: { metric: string; value: number }[] = [];

  // ── 1. process_uptime_seconds — restart canary
  samples.push({
    metric: "hub_app.process_uptime_seconds",
    value: process.uptime(),
  });

  // ── 2. rss_bytes — Node heap RSS
  samples.push({
    metric: "hub_app.rss_bytes",
    value: process.memoryUsage().rss,
  });

  // ── 3. cgroup_mem_bytes — whole-container memory (cgroup v2)
  try {
    const mem = await readFile("/sys/fs/cgroup/memory.current", "utf8");
    samples.push({
      metric: "hub_app.cgroup_mem_bytes",
      value: parseInt(mem.trim(), 10),
    });
  } catch {
    // Not on cgroup v2 (e.g. macOS dev box) — skip silently.
  }

  // ── 4. cpu_user_seconds_total — cumulative; chart slope = %CPU
  samples.push({
    metric: "hub_app.cpu_user_seconds_total",
    value: process.cpuUsage().user / 1_000_000,
  });

  // ── 5. oom_group_kill_count — container-level OOM events
  try {
    const events = await readKvFile("/sys/fs/cgroup/memory.events");
    samples.push({
      metric: "hub_app.oom_group_kill_count",
      value: events.get("oom_group_kill") ?? 0,
    });
  } catch {
    // memory.events not present (non-cgroup-v2) — skip silently.
  }

  // ── 6. host.disk_free_bytes — host filesystem free space
  try {
    const fsStat = await statfs("/");
    samples.push({
      metric: "host.disk_free_bytes",
      value: fsStat.bavail * fsStat.bsize,
    });
  } catch {
    // statfs unsupported (older Node, exotic OS) — skip silently.
  }

  // ── 7. pg.connection_count — pool exhaustion signal
  try {
    const conns = await db.execute<{ conns: number }>(sql`
      SELECT count(*)::int AS conns FROM pg_stat_activity
       WHERE datname = current_database()
    `);
    samples.push({
      metric: "pg.connection_count",
      value: conns.rows[0]?.conns ?? 0,
    });
  } catch (e) {
    console.error(LOG_PREFIX, "pg.connection_count failed", e);
  }

  // ── 8. pg.db_size_bytes — storage growth
  // pg_database_size() returns bigint, which the pg driver yields as a string
  // (bigints can exceed JS's safe int range). Coerce to number — DB size in
  // bytes won't approach 2^53 for our workload.
  try {
    const dbSize = await db.execute<{ size: string | number }>(sql`
      SELECT pg_database_size(current_database()) AS size
    `);
    const raw = dbSize.rows[0]?.size ?? 0;
    samples.push({
      metric: "pg.db_size_bytes",
      value: typeof raw === "string" ? Number(raw) : raw,
    });
  } catch (e) {
    console.error(LOG_PREFIX, "pg.db_size_bytes failed", e);
  }

  // ── 9. memories.row_count — hub utilization
  try {
    const memCount = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM memories
    `);
    samples.push({
      metric: "memories.row_count",
      value: memCount.rows[0]?.n ?? 0,
    });
  } catch (e) {
    console.error(LOG_PREFIX, "memories.row_count failed", e);
  }

  // ── 10. sessions.row_count — active client proxy
  try {
    const sessCount = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM sessions
    `);
    samples.push({
      metric: "sessions.row_count",
      value: sessCount.rows[0]?.n ?? 0,
    });
  } catch (e) {
    console.error(LOG_PREFIX, "sessions.row_count failed", e);
  }

  return samples;
}

export async function collectAndPersist(): Promise<void> {
  const samples = await collectSamples();
  if (samples.length === 0) return;
  await db.insert(systemMetrics).values(samples);
}
