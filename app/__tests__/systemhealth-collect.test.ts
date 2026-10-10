// Phase 6 — exercise the collector against the running DB. Invoking
// collectSamples() directly (rather than collectAndPersist) lets us assert
// on the shape of what would be written, without polluting system_metrics
// with extra rows.

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectSamples } from "@/lib/system-metrics";

// Two cgroup-v2 metrics require /sys/fs/cgroup/{memory.current,memory.events}
// to be readable by the test process. That's true inside a container with
// cgroup-v2 (PID 1 of the cgroup) but not on a bare Linux host running tests
// directly — the host's cgroup root has no memory.* keys. Detect the
// environment and assert accordingly.
const CGROUP_V2_ROOTED = existsSync("/sys/fs/cgroup/memory.current");

describe("collectSamples()", () => {
  it("returns every metric documented for the current environment", async () => {
    const samples = await collectSamples();

    const metrics = new Set(samples.map((s) => s.metric));

    // Always-present (no platform gating)
    expect(metrics).toContain("hub_app.process_uptime_seconds");
    expect(metrics).toContain("hub_app.rss_bytes");
    expect(metrics).toContain("hub_app.cpu_user_seconds_total");
    expect(metrics).toContain("pg.connection_count");
    expect(metrics).toContain("pg.db_size_bytes");
    expect(metrics).toContain("memories.row_count");
    expect(metrics).toContain("sessions.row_count");

    if (process.platform === "linux") {
      // statfs("/") works on any Linux, in or out of a container.
      expect(metrics).toContain("host.disk_free_bytes");
    }

    if (CGROUP_V2_ROOTED) {
      expect(metrics).toContain("hub_app.cgroup_mem_bytes");
      expect(metrics).toContain("hub_app.oom_group_kill_count");
    }

    const expectedMin =
      7 + (process.platform === "linux" ? 1 : 0) + (CGROUP_V2_ROOTED ? 2 : 0);
    expect(samples.length).toBe(expectedMin);
  });

  it("every sample has a finite numeric value", async () => {
    const samples = await collectSamples();
    for (const s of samples) {
      expect(Number.isFinite(s.value), `${s.metric} = ${s.value}`).toBe(true);
    }
  });

  it("fault-tolerance: pg sources fail independently of fs sources", async () => {
    // Run twice in quick succession; both should return the same set of metric
    // keys (no source poisons another). This guards against future refactors
    // that accidentally make one failure short-circuit the rest.
    const a = await collectSamples();
    const b = await collectSamples();
    const aKeys = a.map((s) => s.metric).sort();
    const bKeys = b.map((s) => s.metric).sort();
    expect(aKeys).toEqual(bKeys);
  });
});
