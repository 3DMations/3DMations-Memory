import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";
import { authenticate } from "@/lib/auth";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (!q || q.trim().length === 0) {
    return Response.json(
      { error: "q query parameter required (non-empty)" },
      { status: 400 }
    );
  }
  const term = q.trim();

  const limitRaw = parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const score = sql<number>`(
    similarity(${memories.title}, ${term}) * 2 +
    COALESCE(similarity(${memories.content}, ${term}), 0)
  )`;

  const rows = await db
    .select({
      id: memories.id,
      sessionId: memories.sessionId,
      sessionName: sessions.name,
      title: memories.title,
      content: memories.content,
      category: memories.category,
      tags: memories.tags,
      createdAt: memories.createdAt,
      score,
    })
    .from(memories)
    .leftJoin(sessions, sql`${memories.sessionId} = ${sessions.id}`)
    .where(
      sql`(
        ${memories.title} % ${term}
        OR ${memories.content} % ${term}
        OR ${memories.title} ILIKE ${"%" + term + "%"}
        OR ${memories.content} ILIKE ${"%" + term + "%"}
      )`
    )
    .orderBy(desc(score))
    .limit(limit);

  return Response.json({ query: term, count: rows.length, results: rows });
}
