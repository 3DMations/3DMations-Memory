# Phase 6 — Self-Monitoring (`/systemhealth`)

**Date proposed:** 2026-04-27
**Slot:** First slot in Phase 6+ "Conditional Upgrades" — triggered by user request
for visibility into container & DB health without leaving the dashboard.
**Status:** PROPOSED — not yet built. No bring-up gotchas captured yet.

**Target machine:** aiwork-legion (current hub host). Linux kernel exposes
cgroup v2 at `/sys/fs/cgroup/memory.current` (verified 2026-04-27 — the
hub-app container reads its own cgroup memory cleanly from inside).

---

## Why now

Phases 0–5 sealed without a self-monitoring view. The hub has been up 39+ hours
at the time of this writing with no visible drift, but there's no in-app way
to confirm "yes things are healthy" without shelling into the host and running
`docker stats` / `docker compose ps`. As more clients land on the tailnet
(pc-001 just onboarded; 3dm-inspiron-5547 already wired) the hub's
single-host blast radius grows: one hung Postgres connection pool or a leaking
Node heap and every client loses memory access.

Three gaps closed by this phase:

1. **No in-app health view.** `/api/health` returns one boolean. There's no
   trend over time.
2. **No leak-detection signal.** A slow memory leak in `hub-app` would be
   invisible until the container OOM-kills.
3. **No DB growth signal.** memories table grows monotonically; no signal
   when storage trends start to matter.

Phase 6 adds a low-overhead self-monitoring loop: collect a handful of metrics
every 5 min, write them to Postgres, render line charts on a new
`/systemhealth` page that uses the AutoRefresh component shipped in
`3df9e5a`.

---

## Decisions locked in this session

| Decision | Choice | Rationale |
|---|---|---|
| Collection cadence | **5 min** | User asked for industry standard; 1–5 min is the norm for low-volume internal monitoring (Prometheus 15–60s for prod, 1–5 min for self-hosted dashboards). 5 min × 8 metrics = ~4.2M rows/year — trivial at our scale. |
| Scheduler location | **Next.js `instrumentation.ts` → `setInterval` in node runtime only** | Self-contained; survives without host cron; gap-on-crash IS the canary. Per Next 16.2 docs: gate with `NEXT_RUNTIME === 'nodejs'` so the edge worker doesn't double-fire. |
| Storage shape | **Single `system_metrics` table, no partitioning** | At ~4M rows/year a BTREE index on `(metric, recorded_at DESC)` is plenty. `pg_partman`/`TimescaleDB` are over-engineered for our scale. Re-evaluate if we cross 100M rows. |
| Retention / rollup | **Keep raw forever; aggregate on query** | 4M rows/year is small. Last 24h = 288 samples/metric, last 7d = 2K, last 30d = 8.6K — all fast with the `(metric, recorded_at)` index. Skip rollup tables until query latency forces it. |
| Charting library | **`recharts`** (new prod dep) | React-first, ~1.8M weekly downloads, declarative JSX, sensible TS types. Visx is leaner but high-effort; Nivo is heavier; Chart.js is canvas-only and not React-idiomatic. ~50 KB gzipped is acceptable. |
| Container memory source | **cgroup v2 (`/sys/fs/cgroup/memory.current`)** | Verified readable from inside hub-app. Captures the whole container, not just the Node process. cgroup v1 fallback is `/sys/fs/cgroup/memory/memory.usage_in_bytes` if a future host downgrades. |
| Postgres memory tracking | **Skipped — proxy via connection count + DB size** | Postgres lives in a separate container; reading its cgroup needs cross-container access. Connection count + DB size give equivalent leak-detection signal without that complexity. |
| HTTP error rate | **Deferred to Phase 6.1 if needed** | `audit_log` doesn't have an HTTP status column. Adding it touches schema + every route. Skip in v1; revisit only if the basic 7 metrics miss something. |
| AutoRefresh on /systemhealth | **Yes — 60s like every other page** | Already shipped (`3df9e5a`). Worst-case staleness = 5 min collection + 60s display = 6 min. Plenty fresh for a system-health view. |

---

## Architecture

```
                  ┌────────────────────────────────────┐
                  │       hub-app  (Next.js 16)        │
                  │                                    │
   register() ──► │  instrumentation-node.ts           │
   (once at      │     setInterval(collect, 5 * 60s)  │
    boot)        │           │                         │
                  │           ▼                         │
                  │      collect()                      │
                  │   ├─ /proc/self/status   (Node RSS) │
                  │   ├─ /proc/uptime         (boot age) │
                  │   ├─ /sys/fs/cgroup/...   (container)│
                  │   └─ pg queries:                     │
                  │       • pg_stat_activity (conns)     │
                  │       • pg_database_size             │
                  │       • COUNT(memories), COUNT(sessions) │
                  │           │                         │
                  │           ▼                         │
                  │   INSERT INTO system_metrics ...    │
                  └────────────┬───────────────────────┘
                               │
                               ▼
                  ┌────────────────────────────────────┐
                  │       postgres (hub-db)             │
                  │   system_metrics (id, recorded_at, │
                  │                   metric, value)    │
                  └────────────┬───────────────────────┘
                               │
                  GET /systemhealth                       
                               │
                               ▼
                  ┌────────────────────────────────────┐
                  │  app/systemhealth/page.tsx          │
                  │  Server Component                   │
                  │   → date_trunc query for each chart │
                  │   → renders <LineChart/> from       │
                  │     recharts in client island       │
                  │   → <AutoRefresh /> already mounted │
                  └────────────────────────────────────┘
```

---

## Phase 6a — Schema + collector

### New schema

```ts
// app/db/schema.ts (append)
import { doublePrecision } from "drizzle-orm/pg-core";   // already exported by 0.45.x
                                                          // — verified in node_modules
                                                          // — joins existing imports
                                                          // (text, uuid, timestamp, etc.)

export const systemMetrics = pgTable(
  "system_metrics",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    metric: text("metric").notNull(),       // e.g. "hub_app.rss_bytes"
    value: doublePrecision("value").notNull(),
    metadata: jsonb("metadata").default({}),// optional context (units, source)
  },
  (t) => [
    // Index direction omitted: BTREE scans both ways and our existing schema
    // (idx_audit_session, idx_audit_action) follows the same pattern. At our
    // scale a forward-only BTREE is plenty.
    index("idx_metrics_metric_time").on(t.metric, t.recordedAt),
  ]
);
```

`drizzle-kit push` for the schema sync (Phase 1 still applies — no Alembic
yet). Migration is purely additive; no data backfill needed.

### Metrics captured per tick

The curated 10 (USE method on hub-app + RED on Postgres + host disk).
Each metric ships with **what / source / why** copy that surfaces in the
dashboard's info icon (see Phase 6b).

| # | metric key | unit | source | category |
|---|---|---|---|---|
| 1 | `hub_app.process_uptime_seconds` | seconds | `process.uptime()` | restart canary |
| 2 | `hub_app.rss_bytes` | bytes | `process.memoryUsage().rss` | leak detection (Node heap) |
| 3 | `hub_app.cgroup_mem_bytes` | bytes | `/sys/fs/cgroup/memory.current` | leak detection (whole container) |
| 4 | `hub_app.cpu_user_seconds_total` | seconds (cumulative) | `process.cpuUsage().user / 1_000_000` | saturation (slope = %CPU) |
| 5 | `hub_app.oom_group_kill_count` | count | `oom_group_kill` field in `/sys/fs/cgroup/memory.events` | container-level OOM events |
| 6 | `host.disk_free_bytes` | bytes | `fs.statfs("/")` (or volumes path) | storage exhaustion |
| 7 | `pg.connection_count` | int | `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()` | pool exhaustion |
| 8 | `pg.db_size_bytes` | bytes | `SELECT pg_database_size(current_database())` | storage growth |
| 9 | `memories.row_count` | int | `SELECT count(*) FROM memories` | hub utilization |
| 10 | `sessions.row_count` | int | `SELECT count(*) FROM sessions` | active client proxy |

**Cost at 5-min cadence:** 10 × 12/hr × 24 × 365 = **~1.05M rows/year**.
Each row is ~80 bytes; the table grows ~84 MB/year. Postgres won't notice;
no rollup needed until we cross ~30M rows.

### Collector sketch (illustrative — exact form lands in 6a build)

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}

// instrumentation-node.ts
import { db } from "@/db";
import { systemMetrics } from "@/db/schema";
import { sql } from "drizzle-orm";
import { readFile, statfs } from "node:fs/promises";

const COLLECT_INTERVAL_MS = 5 * 60 * 1000;

// Parses a file shaped like "key value\nkey value\n..." into a map.
async function readKvFile(path: string): Promise<Map<string, number>> {
  const txt = await readFile(path, "utf8");
  const m = new Map<string, number>();
  for (const line of txt.split("\n")) {
    const [k, v] = line.split(/\s+/);
    if (k && v) m.set(k, Number(v));
  }
  return m;
}

async function collect() {
  const samples: { metric: string; value: number }[] = [];

  // ── 1. hub_app.process_uptime_seconds  (restart canary)
  samples.push({ metric: "hub_app.process_uptime_seconds", value: process.uptime() });

  // ── 2. hub_app.rss_bytes  (Node heap)
  samples.push({ metric: "hub_app.rss_bytes", value: process.memoryUsage().rss });

  // ── 3. hub_app.cgroup_mem_bytes  (whole container)
  try {
    const mem = await readFile("/sys/fs/cgroup/memory.current", "utf8");
    samples.push({ metric: "hub_app.cgroup_mem_bytes", value: parseInt(mem.trim(), 10) });
  } catch { /* not on cgroup v2 — skip */ }

  // ── 4. hub_app.cpu_user_seconds_total  (cumulative; slope = %CPU)
  samples.push({
    metric: "hub_app.cpu_user_seconds_total",
    value: process.cpuUsage().user / 1_000_000,
  });

  // ── 5. hub_app.oom_group_kill_count
  try {
    const events = await readKvFile("/sys/fs/cgroup/memory.events");
    samples.push({
      metric: "hub_app.oom_group_kill_count",
      value: events.get("oom_group_kill") ?? 0,
    });
  } catch { /* not on cgroup v2 — skip */ }

  // ── 6. host.disk_free_bytes
  try {
    const fs = await statfs("/");
    samples.push({ metric: "host.disk_free_bytes", value: fs.bavail * fs.bsize });
  } catch { /* statfs unsupported — skip */ }

  // db.execute usage matches the existing pattern in app/app/api/health/route.ts:
  //   const result = await db.execute<{ field: T }>(sql`...`);
  //   result.rows[0]?.field;
  // Drizzle's pg-driver `execute<T>()` returns a QueryResult with .rows: T[].

  // ── 7. pg.connection_count
  const conns = await db.execute<{ conns: number }>(sql`
    SELECT count(*)::int AS conns FROM pg_stat_activity WHERE datname = current_database()
  `);
  samples.push({ metric: "pg.connection_count", value: conns.rows[0]?.conns ?? 0 });

  // ── 8. pg.db_size_bytes
  const dbSize = await db.execute<{ size: number }>(sql`
    SELECT pg_database_size(current_database())::bigint AS size
  `);
  samples.push({ metric: "pg.db_size_bytes", value: dbSize.rows[0]?.size ?? 0 });

  // ── 9. memories.row_count
  const memCount = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM memories
  `);
  samples.push({ metric: "memories.row_count", value: memCount.rows[0]?.n ?? 0 });

  // ── 10. sessions.row_count
  const sessCount = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM sessions
  `);
  samples.push({ metric: "sessions.row_count", value: sessCount.rows[0]?.n ?? 0 });

  // Single batch insert (one round-trip)
  await db.insert(systemMetrics).values(samples);
}

// Fire once at boot (so /systemhealth has data on first load), then every 5 min.
collect().catch((e) => console.error("[systemhealth] initial collect failed", e));
setInterval(() => {
  collect().catch((e) => console.error("[systemhealth] tick failed", e));
}, COLLECT_INTERVAL_MS);
```

**Key safety properties:**

- Each subsystem (proc, cgroup, pg) is independently fault-tolerant. If
  `/proc/uptime` fails, we still capture cgroup + pg samples. If pg fails,
  the `setInterval` keeps trying — the next tick re-attempts.
- Errors are logged to stderr (Next.js captures), never thrown to the runtime.
  An exception in `collect()` would not impact request handling.
- Single `INSERT ... VALUES` for all samples means atomic write per tick.
- No dependency on host cron, no extra container.

**Known caveat:** a Next.js dev-mode worker can re-fork the instrumentation
hook. Production (`next start`) is single-process so this doesn't bite us
in our docker-compose `app` service. The `app-debug` profile uses dev mode
and may double-collect — fine, it's debug only.

---

## Phase 6b — Dashboard page

### Routes

- `app/app/systemhealth/page.tsx` — Server Component, `force-dynamic`, queries
  the last 24h aggregated to ~10-min buckets via `date_trunc('minute', ...)`.
- Mounts `<AutoRefresh />` (already in `_components/`) for 60s tab-focus refresh.
- Mounts client-island `<MetricsCharts data={...} />` to render recharts.

### Info-icon UX

Each chart card has a small **ⓘ** glyph (i in a circle) next to the metric
title. The icon is keyboard-focusable, opens on hover for desktop and on
click/tap for touch, and surfaces three short fields:

- **What** — one-line description of the metric.
- **Source** — exactly where the value comes from (so you can sanity-check).
- **Why** — what reading this number tells you about hub health.

The popover is built in-house (no new tooltip dep). Single client component
that wraps an SVG `<circle><text>i</text></circle>` button + a positioned
`role="tooltip"` panel. ESC dismisses; click-outside dismisses; menu uses
the existing `--surface`, `--border`, and `--shadow-lg` tokens for design
parity with `SettingsMenu.tsx`.

#### Per-metric copy (canonical text, kept in code as a const map)

| metric | What | Why it matters |
|---|---|---|
| `hub_app.process_uptime_seconds` | Seconds since the hub-app Node process started. | Drops to 0 when the container restarts. A surprise dip means hub-app crashed, OOM'd, or was redeployed without you knowing. |
| `hub_app.rss_bytes` | Resident Set Size of the Node process — physical RAM in use right now. | Slow upward drift over days = memory leak. Sudden spikes correlate with traffic patterns and request shapes. |
| `hub_app.cgroup_mem_bytes` | Total memory used by the entire `hub-app` container, not just Node. | Captures Node + child processes + page cache. Approaching the cgroup limit means OOM-kill is imminent. |
| `hub_app.cpu_user_seconds_total` | Cumulative user-space CPU seconds the Node process has burned. | The chart shows a slope rather than a level — flat = idle, steep = saturated or stuck in a loop. |
| `hub_app.oom_group_kill_count` | Number of times the kernel killed the entire container as a unit. | Should be 0. Non-zero correlates with `process_uptime_seconds` resets and means you're allocating beyond the cgroup limit. |
| `host.disk_free_bytes` | Free space remaining on the host filesystem the docker volumes live on. | Docker volumes silently fill until they don't. Postgres throws cryptic errors when out of space — you want a week of warning, not a minute. |
| `pg.connection_count` | Open connections to the database right now. | Postgres has a hard `max_connections` cap (default 100). A creeping count means a leaky pool somewhere; hitting the cap stops writes. |
| `pg.db_size_bytes` | Total disk space used by data + indexes for our database. | Trend tells you how fast memories are accumulating. Flat = no writes; sudden growth = unusual ingestion event. |
| `memories.row_count` | Number of rows in the `memories` table. | Hub utilization. Should be monotonically increasing. A drop means a session was deleted with cascade, or someone ran a destructive SQL. |
| `sessions.row_count` | Number of rows in the `sessions` table. | Proxy for "how many clients have been onboarded." Drops indicate session deletions; flat means no growth on the tailnet. |

### Client island sketch

```tsx
// app/app/systemhealth/MetricsCharts.tsx
"use client";

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";
import MetricInfo from "./MetricInfo";
import { METRIC_DOCS } from "./metric-docs";

interface Series {
  metric: string;
  points: { t: string; v: number }[];
  unit: "bytes" | "seconds" | "count";
}

export default function MetricsCharts({ series }: { series: Series[] }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {series.map((s) => {
        const doc = METRIC_DOCS[s.metric];
        return (
          <div key={s.metric} className="rounded-[var(--radius-card)] border border-border p-4">
            <h2 className="text-[16px] font-medium mb-2 flex items-center gap-1.5">
              <span>{s.metric}</span>
              {doc && <MetricInfo {...doc} />}
            </h2>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={s.points}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="v" stroke="var(--accent)" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
```

```tsx
// app/app/systemhealth/MetricInfo.tsx — info-icon popover, ~50 LoC
"use client";
import { useState, useRef, useEffect } from "react";

export interface MetricDoc {
  what: string;
  source: string;
  why: string;
}

export default function MetricInfo(doc: MetricDoc) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  return (
    <span ref={wrap} className="relative inline-block">
      <button
        type="button"
        aria-label="About this metric"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[11px] text-text-muted hover:text-text hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        i
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute left-0 top-6 z-30 w-72 rounded-[var(--radius-card)] border border-border bg-surface p-3 text-[13.5px] text-text shadow-[var(--shadow-lg)]"
        >
          <p><span className="font-medium text-text-muted">What:</span> {doc.what}</p>
          <p className="mt-1.5"><span className="font-medium text-text-muted">Source:</span> <code className="font-mono text-[12.5px]">{doc.source}</code></p>
          <p className="mt-1.5"><span className="font-medium text-text-muted">Why:</span> {doc.why}</p>
        </div>
      )}
    </span>
  );
}
```

```ts
// app/app/systemhealth/metric-docs.ts — single source of truth for the popover text
export const METRIC_DOCS: Record<string, { what: string; source: string; why: string }> = {
  "hub_app.process_uptime_seconds": { /* what/source/why per the table above */ ... },
  // ...10 entries total, mirroring the table in "Per-metric copy"
};
```

### Why recharts and not alternatives

| Library | Weekly DL | Bundle | DX | Verdict |
|---|---|---|---|---|
| **recharts** | ~1.8M | ~50 KB gz | declarative JSX, common types pre-built | **chosen — pin `^3.8.1`** |
| visx | ~300K | ~15 KB gz | low-level D3 primitives, steeper curve | overkill — we want defaults, not control |
| Nivo | ~450K | larger | beautiful, accessibility-first | nice but heavier; we don't need WCAG AA polish for `/systemhealth` |
| Chart.js | (canvas) | ~70 KB gz | non-React idioms (canvas + imperative) | wrong fit for our SSR + RSC stack |

#### Install requirements with React 19

Recharts 3.x supports React 19, but per the recharts maintainers and known
issues you must:

1. Install both `recharts` and `react-is`:
   ```
   pnpm add recharts react-is
   ```
2. Pin `react-is` to the same major as React 19 — pnpm overrides in
   `package.json` if the resolved version drifts:
   ```json
   "pnpm": {
     "overrides": {
       "react-is": "$react"
     }
   }
   ```
   This is the documented fix for the React-19/recharts version-mismatch
   warnings (see [recharts#5461](https://github.com/recharts/recharts/issues/5461)).

3. Recharts 3.x is the line that has full React 19 support. 2.15.0 backported
   it for the 2.x branch, but 3.x is what to install for greenfield work.

#### Known SSR caveat

Recharts components are client-only. Always wrap charts in a `"use client"`
component (the `MetricsCharts` island in our sketch above). Don't render
them from a Server Component — the Server Component reads data and passes
it as a prop, the client island renders the SVG.

References: [Recharts vs Chart.js vs Nivo (2026)](https://www.pkgpulse.com/blog/recharts-vs-chartjs-vs-nivo-vs-visx-react-charting-2026), [LogRocket React chart libs (2025)](https://blog.logrocket.com/best-react-chart-libraries-2025/), [recharts/recharts#5461 — React 19 support](https://github.com/recharts/recharts/issues/5461).

---

## Phase 6c — Tests + seal criteria

### New tests

| File | Asserts |
|---|---|
| `__tests__/systemhealth-schema.test.ts` | `system_metrics` row inserts, `(metric, recorded_at)` index exists |
| `__tests__/systemhealth-collect.test.ts` | `collect()` returns the full 10-sample set on Linux/cgroup-v2, ≥6 on non-Linux; one DB row per metric per tick; failure of one source doesn't poison others |
| `__tests__/systemhealth-info.test.ts` | `METRIC_DOCS` has an entry for every metric the collector emits — fails the build if a new metric is added without copy |
| `e2e/systemhealth.spec.ts` (Playwright) | `/systemhealth` renders 10 chart cards; clicking the **ⓘ** glyph on the first card surfaces a tooltip with `What:` / `Source:` / `Why:`; AutoRefresh ticks |

Vitest 61 → ~65. Cucumber 11 unchanged. Playwright 7 → 8.

### Seal criteria

1. After deploy, `/systemhealth` page renders within 500ms with one data
   point per metric for each of the 10 (i.e., ≥1 collection tick has happened).
2. Tail the app logs for one hour: every 5 min there's an INSERT of 10
   rows to `system_metrics` and no `[systemhealth]` errors.
3. Memory chart shows a flat line (sanity — no leak yet) and `pg.db_size_bytes`
   shows steady-or-slow growth.
4. Restart `hub-app`. Verify `hub_app.process_uptime_seconds` resets to
   ~0 on the next tick — confirms the process-uptime source is wired
   correctly. `hub_app.oom_group_kill_count` stays at 0 (the restart was
   manual, not OOM).
5. Click the **ⓘ** on each of the 10 chart cards; verify the popover renders
   with all three fields and dismisses on ESC and click-outside.
6. New tests green: vitest, Playwright, Cucumber.

### Wait-and-watch (1 week before declaring sealed)

- Confirm chart latency stays sub-500ms over a week of accumulated data
  (~28K rows per metric).
- Confirm no spurious gaps in the metric stream (would indicate the
  `setInterval` is dying silently).
- Decide whether HTTP error rate (deferred Phase 6.1), PSI (6.2), or
  `pg_stat_statements` (6.6) are actually needed based on what the
  baseline 10 metrics caught vs. missed.

---

## Phase 6+ — Deferred (do not pre-build)

| Trigger | Upgrade | Effort |
|---|---|---|
| Basic metrics miss an outage | **Phase 6.1** — HTTP status counters via new `request_log` table or `audit_log.status` column | 1–2 hours |
| Want a "is the system stressed?" single-number signal | **Phase 6.2** — PSI (Pressure Stall Information): read `/proc/pressure/{memory,cpu,io}` → percentage of time tasks stalled on each resource. Modern best-practice for Linux 4.20+. Per [Netdata cgroup v2 guide](https://www.netdata.cloud/academy/diagnosing-linux-cgroups/). | 1 hour |
| Charts feel slow at >30 days range | **Phase 6.3** — Hourly rollup table populated by a daily cron-style insert | 2–3 hours |
| Need cross-host visibility (multi-hub) | **Phase 6.4** — OpenTelemetry + Prometheus + Grafana sidecar; Next.js already supports OTEL natively via `instrumentation.ts` + `@vercel/otel` | half-day |
| Need alerting (page someone) | **Phase 6.5** — Threshold rules + a notify channel (Slack/email) | 2–4 hours |
| Container health for db, ts-hub | **Phase 6.6** — Docker stats sidecar reads cross-container cgroup; or eBPF agent (Cilium Tetragon, Pixie) for kernel-level visibility | 3–4 hours |
| Slow query analysis becomes useful | **Phase 6.7** — Enable `pg_stat_statements` extension; track top-N slow queries and rate of slow ones | 2 hours |
| Container limit memory tracking wanted | **Phase 6.8** — Add `hub_app.cgroup_mem_limit_bytes` (`/sys/fs/cgroup/memory.max`) and `hub_app.uptime_seconds` (`/proc/uptime`) — kept out of the baseline 10 because the limit is constant and host uptime is less diagnostic than process uptime | 30 min |
| Need to distinguish single-process vs group OOM | **Phase 6.9** — Add `hub_app.oom_kill_count` (`oom_kill` field). Less diagnostic than `oom_group_kill` for our single-binary container, but exposes child-process kills if we ever spawn workers | 15 min |

---

## Bring-up gotchas

*(To be populated when 6a is built. Section format mirrors `plan-v4.3-phase-3.md`.)*

---

## Sources & external references

- [Next.js 16 Instrumentation guide](https://nextjs.org/docs/app/guides/instrumentation) — `register()` semantics + `NEXT_RUNTIME` gating.
- [Recharts vs Chart.js vs Nivo vs Visx (PkgPulse 2026)](https://www.pkgpulse.com/blog/recharts-vs-chartjs-vs-nivo-vs-visx-react-charting-2026) — chart-library comparison.
- [LogRocket — Best React chart libraries (2025 update)](https://blog.logrocket.com/best-react-chart-libraries-2025/) — supplemental DX comparison.
- [AWS — Designing high-performance time-series tables on RDS PG](https://aws.amazon.com/blogs/database/designing-high-performance-time-series-data-tables-on-amazon-rds-for-postgresql/) — partitioning isn't needed at our scale.
- [Neon — Time-series data in Postgres](https://neon.com/guides/timeseries-data) — confirms simple-table-with-index is appropriate up to ~1M metrics/sec; we're at ~3 metrics/min.
