// Phase 6 — guard rail: every metric the collector emits must have an
// entry in METRIC_DOCS. Adding a new metric to lib/system-metrics.ts
// without updating app/systemhealth/metric-docs.ts fails this test.

import { describe, expect, it } from "vitest";
import { collectSamples } from "@/lib/system-metrics";
import {
  METRIC_DOCS,
  METRIC_ORDER,
} from "@/app/systemhealth/metric-docs";

describe("METRIC_DOCS coverage", () => {
  it("every collector metric has docs", async () => {
    const samples = await collectSamples();
    for (const s of samples) {
      expect(
        METRIC_DOCS[s.metric],
        `missing METRIC_DOCS entry for ${s.metric}`,
      ).toBeDefined();
    }
  });

  it("every doc has non-empty what / source / why", () => {
    for (const [metric, doc] of Object.entries(METRIC_DOCS)) {
      expect(doc.what.length, `${metric}.what`).toBeGreaterThan(0);
      expect(doc.source.length, `${metric}.source`).toBeGreaterThan(0);
      expect(doc.why.length, `${metric}.why`).toBeGreaterThan(0);
      expect(["bytes", "seconds", "count"]).toContain(doc.unit);
    }
  });

  it("METRIC_ORDER matches METRIC_DOCS keys", () => {
    expect([...METRIC_ORDER].sort()).toEqual(Object.keys(METRIC_DOCS).sort());
  });
});
