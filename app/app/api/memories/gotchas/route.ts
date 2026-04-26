import { desc, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";

const DEFAULT_THRESHOLD = 3;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const minRaw = parseInt(url.searchParams.get("min") ?? "", 10);
  const min =
    Number.isFinite(minRaw) && minRaw >= 1 ? minRaw : DEFAULT_THRESHOLD;

  // Bucket A: high-recurrence single rows (recurrence >= min).
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
    .where(gte(memories.recurrence, min))
    .orderBy(desc(memories.recurrence), desc(memories.updatedAt))
    .limit(100);

  // Bucket B: cross-session trigram clusters — same title appears in 2+ sessions.
  // We pick a representative row per cluster (highest recurrence, then most recent).
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
     LIMIT 50
  `);

  return Response.json({
    threshold: min,
    high_recurrence: highRecurrence,
    cross_session: crossSession.rows,
  });
}
