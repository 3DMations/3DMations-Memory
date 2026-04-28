import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import AutoRefresh from "../_components/AutoRefresh";
import PageHeader from "../_components/ui/PageHeader";
import MetricsCharts, { type Series } from "./MetricsCharts";
import { METRIC_ORDER } from "./metric-docs";

export const dynamic = "force-dynamic";

interface BucketRow extends Record<string, unknown> {
  metric: string;
  bucket: string;
  v: number;
}

export default async function SystemHealthPage() {
  // Last 24h, aggregated to ~10-min buckets so charts render quickly even
  // as the table grows. avg() collapses any duplicate ticks within a bucket.
  const result = await db.execute<BucketRow>(sql`
    SELECT metric,
           date_trunc('minute', recorded_at)
             - (EXTRACT(MINUTE FROM recorded_at)::int % 10) * INTERVAL '1 minute'
             AS bucket,
           avg(value) AS v
      FROM system_metrics
     WHERE recorded_at >= now() - INTERVAL '24 hours'
     GROUP BY metric, bucket
     ORDER BY metric, bucket
  `);

  const byMetric = new Map<string, Series>();
  for (const m of METRIC_ORDER) {
    byMetric.set(m, { metric: m, points: [] });
  }
  for (const row of result.rows) {
    const series = byMetric.get(row.metric);
    if (!series) continue; // metric not in canonical list — skip
    series.points.push({
      t: new Date(row.bucket).toISOString(),
      v: Number(row.v),
    });
  }

  const series = Array.from(byMetric.values());
  const totalPoints = series.reduce((acc, s) => acc + s.points.length, 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 font-sans">
      <AutoRefresh />
      <PageHeader
        back={
          <Link
            href="/"
            className="text-text-muted hover:text-text transition-colors"
          >
            ← all sessions
          </Link>
        }
        title="System health"
        description={
          <>
            Last 24h, sampled every 5 min, aggregated to 10-min buckets.{" "}
            {totalPoints} data point{totalPoints === 1 ? "" : "s"} across{" "}
            {METRIC_ORDER.length} metrics. Hover the{" "}
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-semibold align-middle">
              i
            </span>{" "}
            on any chart to see what it measures and why it matters.
          </>
        }
      />

      <MetricsCharts series={series} />
    </main>
  );
}
