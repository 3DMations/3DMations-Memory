import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";
import AutoRefresh from "../_components/AutoRefresh";
import PageHeader from "../_components/ui/PageHeader";
import Card from "../_components/ui/Card";
import EmptyState from "../_components/ui/EmptyState";
import StatPill from "../_components/ui/StatPill";
import { formatEasternStamp } from "@/lib/format-date";

export const dynamic = "force-dynamic";

// drizzle's db.execute<T> requires T extends Record<string, unknown>.
type DayBucket = Record<string, unknown> & {
  day: string; // YYYY-MM-DD
  count: number;
};

type TagRow = Record<string, unknown> & {
  tag: string;
  count: number;
};

type RecurrentRow = Record<string, unknown> & {
  id: string;
  title: string;
  recurrence: number;
  session_id: string | null;
  session_name: string | null;
};

export default async function StatsPage() {
  // Counts
  const [{ totalMemories }] = await db
    .select({ totalMemories: sql<number>`COUNT(*)::int` })
    .from(memories);
  const [{ totalSessions }] = await db
    .select({ totalSessions: sql<number>`COUNT(*)::int` })
    .from(sessions);
  const [{ unhashed }] = await db
    .select({ unhashed: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(sql`${memories.contentHash} IS NULL`);

  // Memories per day for the last 30 days.
  const overTime = await db.execute<DayBucket>(sql`
    SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
           COALESCE(c.count, 0)::int AS count
      FROM generate_series(
             (now() - INTERVAL '29 days')::date,
             now()::date,
             '1 day'
           ) AS d
      LEFT JOIN (
        SELECT date_trunc('day', created_at)::date AS day,
               COUNT(*) AS count
          FROM memories
         WHERE created_at > now() - INTERVAL '30 days'
         GROUP BY 1
      ) c ON c.day = d::date
     ORDER BY day
  `);

  // Top tags
  const tagsResult = await db.execute<TagRow>(sql`
    SELECT t AS tag, COUNT(*)::int AS count
      FROM memories, UNNEST(tags) AS t
     GROUP BY t
     ORDER BY count DESC
     LIMIT 10
  `);

  // Most recurrent (recurrence >= 2)
  const recurrent = await db.execute<RecurrentRow>(sql`
    SELECT m.id::text AS id,
           m.title AS title,
           m.recurrence AS recurrence,
           m.session_id AS session_id,
           s.name AS session_name
      FROM memories m
      LEFT JOIN sessions s ON s.id = m.session_id
     WHERE m.recurrence >= 2
     ORDER BY m.recurrence DESC, m.updated_at DESC
     LIMIT 10
  `);

  const recentSessions = await db
    .select({
      id: sessions.id,
      name: sessions.name,
      lastSeen: sessions.lastSeen,
      memoryCount: sql<number>`COUNT(${memories.id})::int`,
    })
    .from(sessions)
    .leftJoin(memories, sql`${memories.sessionId} = ${sessions.id}`)
    .groupBy(sessions.id)
    .orderBy(desc(sessions.lastSeen))
    .limit(5);

  // Sparkline scaling for the over-time chart
  const days = overTime.rows;
  const maxCount = Math.max(1, ...days.map((d) => d.count));

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12 font-sans">
      <AutoRefresh />
      <PageHeader
        back={
          <Link href="/" className="text-text-muted hover:text-text transition-colors">
            ← all sessions
          </Link>
        }
        title="Stats"
        description="Activity, recurrence, and tag distribution across the hub."
      />

      {/* KPI row */}
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Memories" value={totalMemories} />
        <Kpi label="Sessions" value={totalSessions} />
        <Kpi
          label="Unhashed (legacy)"
          value={unhashed}
          tone={unhashed > 0 ? "warning" : "neutral"}
        />
      </div>

      {/* Over time */}
      <Card className="mb-8 px-5 py-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15.5px] font-semibold text-text">
            Memories created — last 30 days
          </h2>
          <span className="text-[14px] text-text-subtle">
            {days.reduce((a, d) => a + d.count, 0)} total
          </span>
        </div>
        {/* Bar sparkline */}
        <div className="flex items-end gap-[3px] h-24">
          {days.map((d) => {
            const h = Math.round((d.count / maxCount) * 100);
            return (
              <div
                key={d.day}
                className="flex-1 rounded-sm bg-accent/60 hover:bg-accent transition-colors"
                style={{ height: `${Math.max(h, 2)}%` }}
                title={`${d.day}: ${d.count}`}
              />
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[13px] text-text-subtle">
          <span>{days[0]?.day}</span>
          <span>{days[days.length - 1]?.day}</span>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Top tags */}
        <Card className="px-5 py-5">
          <h2 className="mb-3 text-[15.5px] font-semibold text-text">Top tags</h2>
          {tagsResult.rows.length === 0 ? (
            <p className="text-[14.5px] text-text-subtle">— no tags yet —</p>
          ) : (
            <ul className="space-y-1.5">
              {tagsResult.rows.map((t) => (
                <li key={t.tag} className="flex items-center justify-between">
                  <code className="font-mono text-[15px] text-text">{t.tag}</code>
                  <StatPill tone="accent">{t.count}</StatPill>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Most recurrent */}
        <Card className="px-5 py-5">
          <h2 className="mb-3 text-[15.5px] font-semibold text-text">
            Most recurrent
          </h2>
          {recurrent.rows.length === 0 ? (
            <EmptyState
              title="No recurrence yet"
              description="Memories with the same local_entry_id within a session bump recurrence."
            />
          ) : (
            <ul className="space-y-2">
              {recurrent.rows.map((r) => (
                <li
                  key={r.id}
                  className="rounded-[var(--radius-button)] bg-surface-2 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {r.session_id ? (
                        <Link
                          href={`/s/${r.session_id}`}
                          className="text-[15px] font-medium text-text hover:text-accent line-clamp-1"
                        >
                          {r.title}
                        </Link>
                      ) : (
                        <span className="text-[15px] font-medium text-text line-clamp-1">
                          {r.title}
                        </span>
                      )}
                      {r.session_name && (
                        <div className="text-[13px] text-text-subtle mt-0.5">
                          {r.session_name}
                        </div>
                      )}
                    </div>
                    <StatPill tone="accent">×{r.recurrence}</StatPill>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Recent sessions */}
      <Card className="mt-4 px-5 py-5">
        <h2 className="mb-3 text-[15.5px] font-semibold text-text">
          Recent sessions
        </h2>
        <ul className="space-y-1.5">
          {recentSessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/s/${s.id}`}
                className="flex items-center justify-between rounded-[var(--radius-button)] bg-surface-2 px-3 py-2 hover:bg-border transition-colors"
              >
                <div>
                  <div className="text-[15px] font-medium text-text">{s.name}</div>
                  <div className="text-[13px] text-text-subtle font-mono mt-0.5">
                    last seen {formatEasternStamp(s.lastSeen ?? null)}
                  </div>
                </div>
                <StatPill tone="neutral">{s.memoryCount} memor{s.memoryCount === 1 ? "y" : "ies"}</StatPill>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}

function Kpi({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "warning";
}) {
  return (
    <Card className="px-5 py-5">
      <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-text-muted">
        {label}
      </div>
      <div
        className={
          "mt-1 text-[30px] font-semibold tracking-[-0.02em] tabular-nums " +
          (tone === "warning" ? "text-warning" : "text-text")
        }
      >
        {value}
      </div>
    </Card>
  );
}
