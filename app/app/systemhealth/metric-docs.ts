// Phase 6 — single source of truth for the info-icon popover text on
// /systemhealth. Adding a new metric to instrumentation-node.ts without an
// entry here is caught by __tests__/systemhealth-info.test.ts.

export interface MetricDoc {
  what: string;
  source: string;
  why: string;
  unit: "bytes" | "seconds" | "count";
}

export const METRIC_DOCS: Record<string, MetricDoc> = {
  "hub_app.process_uptime_seconds": {
    what: "Seconds since the hub-app Node.js process started.",
    source: "process.uptime()",
    why: "Drops to 0 when the container restarts. A surprise dip means hub-app crashed, OOM'd, or was redeployed without you knowing.",
    unit: "seconds",
  },
  "hub_app.rss_bytes": {
    what: "Resident Set Size of the Node process — physical RAM in use right now.",
    source: "process.memoryUsage().rss",
    why: "Slow upward drift over days indicates a memory leak. Sudden spikes correlate with traffic patterns and request shapes.",
    unit: "bytes",
  },
  "hub_app.cgroup_mem_bytes": {
    what: "Total memory used by the entire hub-app container, not just Node.",
    source: "/sys/fs/cgroup/memory.current",
    why: "Captures Node + child processes + page cache. Approaching the cgroup limit means OOM-kill is imminent.",
    unit: "bytes",
  },
  "hub_app.cpu_user_seconds_total": {
    what: "Cumulative user-space CPU seconds the Node process has burned.",
    source: "process.cpuUsage().user / 1_000_000",
    why: "The chart shows a slope rather than a level — flat = idle, steep = saturated or stuck in a loop.",
    unit: "seconds",
  },
  "hub_app.oom_group_kill_count": {
    what: "Number of times the kernel killed the entire container as a unit.",
    source: "oom_group_kill field in /sys/fs/cgroup/memory.events",
    why: "Should be 0. Non-zero correlates with process_uptime_seconds resets and means you're allocating beyond the cgroup limit.",
    unit: "count",
  },
  "host.disk_free_bytes": {
    what: "Free space remaining on the host filesystem the docker volumes live on.",
    source: 'fs.statfs("/")',
    why: "Docker volumes silently fill until they don't. Postgres throws cryptic errors when out of space — you want a week of warning, not a minute.",
    unit: "bytes",
  },
  "pg.connection_count": {
    what: "Open connections to the database right now.",
    source: "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()",
    why: "Postgres has a hard max_connections cap (default 100). A creeping count means a leaky pool somewhere; hitting the cap stops writes.",
    unit: "count",
  },
  "pg.db_size_bytes": {
    what: "Total disk space used by data + indexes for our database.",
    source: "SELECT pg_database_size(current_database())",
    why: "Trend tells you how fast memories are accumulating. Flat = no writes; sudden growth = unusual ingestion event.",
    unit: "bytes",
  },
  "memories.row_count": {
    what: "Number of rows in the memories table.",
    source: "SELECT count(*) FROM memories",
    why: "Hub utilization. Should be monotonically increasing. A drop means a session was deleted with cascade, or someone ran a destructive SQL.",
    unit: "count",
  },
  "sessions.row_count": {
    what: "Number of rows in the sessions table.",
    source: "SELECT count(*) FROM sessions",
    why: "Proxy for how many clients have been onboarded. Drops indicate session deletions; flat means no growth on the tailnet.",
    unit: "count",
  },
};

export const METRIC_ORDER: string[] = [
  "hub_app.process_uptime_seconds",
  "hub_app.rss_bytes",
  "hub_app.cgroup_mem_bytes",
  "hub_app.cpu_user_seconds_total",
  "hub_app.oom_group_kill_count",
  "host.disk_free_bytes",
  "pg.connection_count",
  "pg.db_size_bytes",
  "memories.row_count",
  "sessions.row_count",
];
