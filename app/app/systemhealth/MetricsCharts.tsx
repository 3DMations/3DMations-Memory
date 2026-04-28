"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import MetricInfo from "./MetricInfo";
import { METRIC_DOCS, METRIC_ORDER, type MetricDoc } from "./metric-docs";

export interface Series {
  metric: string;
  points: { t: string; v: number }[];
}

function formatValue(value: number, unit: MetricDoc["unit"]): string {
  if (unit === "bytes") {
    if (value >= 1e9) return (value / 1e9).toFixed(2) + " GB";
    if (value >= 1e6) return (value / 1e6).toFixed(1) + " MB";
    if (value >= 1e3) return (value / 1e3).toFixed(1) + " KB";
    return value.toFixed(0) + " B";
  }
  if (unit === "seconds") {
    if (value >= 86400) return (value / 86400).toFixed(2) + " d";
    if (value >= 3600) return (value / 3600).toFixed(2) + " h";
    if (value >= 60) return (value / 60).toFixed(1) + " m";
    return value.toFixed(1) + " s";
  }
  return value.toLocaleString();
}

function formatTimestamp(t: string): string {
  // ISO timestamp → HH:MM in local time for chart axes/tooltips.
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function MetricsCharts({ series }: { series: Series[] }) {
  // Render in canonical order so the page layout is stable across reloads.
  const byMetric = new Map(series.map((s) => [s.metric, s]));

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {METRIC_ORDER.map((metric) => {
        const doc = METRIC_DOCS[metric];
        const s = byMetric.get(metric);
        const latest = s && s.points.length > 0 ? s.points[s.points.length - 1].v : null;

        return (
          <div
            key={metric}
            className="rounded-[var(--radius-card)] border border-border bg-surface/30 p-4"
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-1.5 text-[15px] font-medium text-text">
                <span className="font-mono text-[14px]">{metric}</span>
                {doc && <MetricInfo {...doc} />}
              </h2>
              {latest !== null && doc && (
                <span className="font-mono text-[13.5px] text-text-muted">
                  {formatValue(latest, doc.unit)}
                </span>
              )}
            </div>

            {!s || s.points.length === 0 ? (
              <div className="flex h-[160px] items-center justify-center text-[13.5px] text-text-subtle">
                no data yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <LineChart
                  data={s.points}
                  margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border)"
                    opacity={0.4}
                  />
                  <XAxis
                    dataKey="t"
                    tickFormatter={formatTimestamp}
                    fontSize={11}
                    stroke="var(--text-subtle)"
                    minTickGap={40}
                  />
                  <YAxis
                    fontSize={11}
                    stroke="var(--text-subtle)"
                    tickFormatter={(v: number) =>
                      doc ? formatValue(v, doc.unit) : v.toString()
                    }
                    width={60}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-card)",
                      fontSize: "13px",
                    }}
                    labelFormatter={(label) =>
                      typeof label === "string"
                        ? new Date(label).toLocaleString()
                        : String(label ?? "")
                    }
                    formatter={(value) => {
                      const n = typeof value === "number" ? value : Number(value);
                      const str = doc && Number.isFinite(n) ? formatValue(n, doc.unit) : String(value);
                      return [str, metric] as [string, string];
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="v"
                    stroke="var(--accent)"
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        );
      })}
    </div>
  );
}
