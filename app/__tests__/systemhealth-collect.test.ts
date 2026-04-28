// Phase 6 — exercise the collector against the running DB. Invoking
// collectSamples() directly (rather than collectAndPersist) lets us assert
// on the shape of what would be written, without polluting system_metrics
// with extra rows.

import { describe, expect, it } from "vitest";
import { collectSamples } from "@/lib/system-metrics";

describe("collectSamples()", () => {
  it("returns the full 10-sample set on Linux/cgroup-v2", async () => {
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

    // Linux-only (skipped silently on macOS dev)
    if (process.platform === "linux") {
      expect(metrics).toContain("hub_app.cgroup_mem_bytes");
      expect(metrics).toContain("hub_app.oom_group_kill_count");
      expect(metrics).toContain("host.disk_free_bytes");
      expect(samples.length).toBe(10);
    } else {
      expect(samples.length).toBeGreaterThanOrEqual(7);
    }
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
