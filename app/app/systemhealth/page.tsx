import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import AutoRefresh from "../_components/AutoRefresh";
import PageHeader from "../_components/ui/PageHeader";
import MetricsCharts, { type Series } from "./MetricsCharts";
import { METRIC_ORDER } from "./metric-docs";

export const dynamic = "force-dynamic";

// Bucket sizes scale with window so each chart stays at ~150-200 points
// regardless of range. Postgres date_bin (14+) handles arbitrary intervals;
// we're on PG18 so it's available natively.
type RangeKey = "24h" | "7d" | "30d" | "90d" | "1y";

const RANGE_CONFIG: Record<
  RangeKey,
  { label: string; window: string; bucket: string; description: string }
> = {
  "24h": {
    label: "24h",
    window: "24 hours",
    bucket: "10 minutes",
    description: "Last 24 hours, aggregated to 10-min buckets",
  },
  "7d": {
    label: "7d",
    window: "7 days",
    bucket: "1 hour",
    description: "Last 7 days, aggregated to hourly buckets",
  },
  "30d": {
    label: "30d",
    window: "30 days",
    bucket: "4 hours",
    description: "Last 30 days, aggregated to 4-hour buckets",
  },
  "90d": {
    label: "90d",
    window: "90 days",
    bucket: "12 hours",
    description: "Last 90 days, aggregated to 12-hour buckets",
  },
  "1y": {
    label: "1y",
    window: "365 days",
    bucket: "1 day",
    description: "Last 365 days, aggregated to daily buckets",
  },
};

const ALL_RANGES: RangeKey[] = ["24h", "7d", "30d", "90d", "1y"];

function isRangeKey(s: string | undefined): s is RangeKey {
  return s !== undefined && (ALL_RANGES as string[]).includes(s);
}

interface BucketRow extends Record<string, unknown> {
  metric: string;
  bucket: string;
  v: number;
}

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

export default async function SystemHealthPage({ searchParams }: PageProps) {
  const { range: rangeParam } = await searchParams;
  const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : "24h";
  const cfg = RANGE_CONFIG[range];

  // ::interval cast lets us parameterize the bucket / window strings safely
  // through drizzle's sql tag — values are bound as parameters, not concatenated.
  const result = await db.execute<BucketRow>(sql`
    SELECT metric,
           date_bin(${cfg.bucket}::interval, recorded_at, '2000-01-01'::timestamptz) AS bucket,
           avg(value) AS v
      FROM system_metrics
     WHERE recorded_at >= now() - ${cfg.window}::interval
     GROUP BY metric, bucket
     ORDER BY metric, bucket
  `);

  const byMetric = new Map<string, Series>();
  for (const m of METRIC_ORDER) {
    byMetric.set(m, { metric: m, points: [] });
  }
  for (const row of result.rows) {
    const series = byMetric.get(row.metric);
    if (!series) continue;
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
            {cfg.description}. {totalPoints} data point
            {totalPoints === 1 ? "" : "s"} across {METRIC_ORDER.length} metrics.
            Hover the{" "}
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-semibold align-middle">
              i
            </span>{" "}
            on any chart to see what it measures and why it matters.
          </>
        }
      />

      <nav
        aria-label="Time range"
        className="mb-6 inline-flex rounded-[var(--radius-button)] border border-border bg-surface/30 p-1 text-[14px]"
      >
        {ALL_RANGES.map((r) => {
          const active = r === range;
          return (
            <Link
              key={r}
              href={`/systemhealth?range=${r}`}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-[var(--radius-button)] bg-accent px-3 py-1 font-medium text-bg shadow-[var(--shadow-sm)]"
                  : "rounded-[var(--radius-button)] px-3 py-1 text-text-muted hover:text-text"
              }
            >
              {RANGE_CONFIG[r].label}
            </Link>
          );
        })}
      </nav>

      <MetricsCharts series={series} />
    </main>
  );
}
