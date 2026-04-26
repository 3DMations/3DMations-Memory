import Link from "next/link";
import { desc, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";
import PageHeader from "../_components/ui/PageHeader";
import Card from "../_components/ui/Card";
import EmptyState from "../_components/ui/EmptyState";
import StatPill from "../_components/ui/StatPill";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ min?: string }>;
}

export default async function GotchasPage({ searchParams }: PageProps) {
  const { min } = await searchParams;
  const minRaw = parseInt(min ?? "", 10);
  const threshold =
    Number.isFinite(minRaw) && minRaw >= 1 ? minRaw : 3;

  const highRecurrence = await db
    .select({
      id: memories.id,
      title: memories.title,
      content: memories.content,
      category: memories.category,
      recurrence: memories.recurrence,
      sessionId: memories.sessionId,
      sessionName: sessions.name,
      updatedAt: memories.updatedAt,
    })
    .from(memories)
    .leftJoin(sessions, sql`${memories.sessionId} = ${sessions.id}`)
    .where(gte(memories.recurrence, threshold))
    .orderBy(desc(memories.recurrence), desc(memories.updatedAt))
    .limit(50);

  const crossSession = await db.execute<
    Record<string, unknown> & {
      id: string;
      title: string;
      similar_titles: string[];
      session_count: number;
    }
  >(sql`
    WITH titled AS (
      SELECT id::text AS id, title, session_id, recurrence, updated_at
        FROM memories
       WHERE session_id IS NOT NULL
    ),
    pairs AS (
      SELECT a.title AS title_a,
             b.title AS title_b,
             a.session_id AS sa,
             b.session_id AS sb,
             similarity(a.title, b.title)::float AS sim
        FROM titled a, titled b
       WHERE a.session_id < b.session_id
         AND similarity(a.title, b.title) > 0.5
    ),
    clusters AS (
      SELECT title_a AS title,
             ARRAY_AGG(DISTINCT title_b) AS similar_titles,
             COUNT(DISTINCT sa) + COUNT(DISTINCT sb) AS session_count
        FROM pairs
       GROUP BY title_a
    )
    SELECT m.id::text, m.title, c.similar_titles, c.session_count::int
      FROM clusters c
      JOIN LATERAL (
        SELECT id, title FROM memories
         WHERE title = c.title
         ORDER BY recurrence DESC, updated_at DESC
         LIMIT 1
      ) m ON true
     ORDER BY c.session_count DESC
     LIMIT 30
  `);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12 font-sans">
      <PageHeader
        back={
          <Link href="/" className="text-text-muted hover:text-text transition-colors">
            ← all sessions
          </Link>
        }
        title="Gotchas"
        description={
          <>
            Recurring patterns the hub has noticed. High-recurrence rows
            (≥{threshold}× same <code className="font-mono">local_entry_id</code>)
            and titles that look the same across sessions.
          </>
        }
      />

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            High recurrence
          </h2>
          <StatPill tone="accent">{highRecurrence.length}</StatPill>
        </div>
        {highRecurrence.length === 0 ? (
          <EmptyState
            title={<>No memory has hit {threshold}× yet</>}
            description={
              <>
                As Claude writes the same <code className="font-mono">local_entry_id</code> repeatedly,
                its recurrence count climbs. Things hit ≥3 here become candidates for
                CLAUDE.md prevention rules.
              </>
            }
          />
        ) : (
          <ul className="space-y-2">
            {highRecurrence.map((m) => (
              <Card as="li" key={m.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {m.sessionId ? (
                      <Link
                        href={`/s/${m.sessionId}`}
                        className="text-[15px] font-medium text-text hover:text-accent leading-snug"
                      >
                        {m.title}
                      </Link>
                    ) : (
                      <span className="text-[15px] font-medium text-text leading-snug">
                        {m.title}
                      </span>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-text-subtle">
                      {m.sessionName && <span>{m.sessionName}</span>}
                      {m.category && <span>· {m.category}</span>}
                    </div>
                  </div>
                  <StatPill tone="accent">×{m.recurrence}</StatPill>
                </div>
                {m.content && (
                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-[13px] text-text-muted leading-relaxed">
                    {m.content}
                  </p>
                )}
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            Cross-session lookalikes
          </h2>
          <StatPill tone="warning">{crossSession.rows.length}</StatPill>
        </div>
        {crossSession.rows.length === 0 ? (
          <EmptyState
            title="No cross-session matches"
            description="Titles that appear (similar) in 2+ sessions show up here. Useful for spotting drift."
          />
        ) : (
          <ul className="space-y-2">
            {crossSession.rows.map((c) => (
              <Card as="li" key={c.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[15px] font-medium text-text leading-snug">
                    {c.title}
                  </span>
                  <StatPill tone="warning">{c.session_count} sessions</StatPill>
                </div>
                {c.similar_titles && c.similar_titles.length > 0 && (
                  <div className="mt-2 text-[12.5px] text-text-muted">
                    Also seen as:{" "}
                    {c.similar_titles.slice(0, 3).map((t, i) => (
                      <span key={t}>
                        {i > 0 && ", "}
                        <code className="font-mono text-[12px]">{t}</code>
                      </span>
                    ))}
                    {c.similar_titles.length > 3 && (
                      <span className="text-text-subtle"> +{c.similar_titles.length - 3} more</span>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
