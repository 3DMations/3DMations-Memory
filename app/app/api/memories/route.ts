import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories } from "@/db/schema";
import { authenticate } from "@/lib/auth";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

interface CreateBody {
  session_id?: unknown;
  title?: unknown;
  content?: unknown;
  category?: unknown;
  tags?: unknown;
  confidence?: unknown;
  recurrence?: unknown;
  local_entry_id?: unknown;
  content_hash?: unknown;
  metadata?: unknown;
}

export async function POST(request: Request) {
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const sessionId = body.session_id;
  const title = body.title;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return Response.json(
      { error: "session_id required (string)" },
      { status: 400 }
    );
  }
  if (typeof title !== "string" || title.trim().length === 0) {
    return Response.json(
      { error: "title required (non-empty string)" },
      { status: 400 }
    );
  }

  const auth = await authenticate(request, sessionId);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const tags =
    Array.isArray(body.tags) && body.tags.every((t) => typeof t === "string")
      ? (body.tags as string[])
      : undefined;
  const confidence =
    typeof body.confidence === "number" &&
    body.confidence >= 0 &&
    body.confidence <= 1
      ? body.confidence
      : undefined;
  const recurrence =
    typeof body.recurrence === "number" && body.recurrence >= 1
      ? Math.floor(body.recurrence)
      : undefined;
  const metadata =
    body.metadata && typeof body.metadata === "object"
      ? (body.metadata as Record<string, unknown>)
      : undefined;

  const insertValue = {
    sessionId,
    title: title.trim(),
    content: typeof body.content === "string" ? body.content : null,
    category: typeof body.category === "string" ? body.category : null,
    localEntryId:
      typeof body.local_entry_id === "string" ? body.local_entry_id : null,
    contentHash:
      typeof body.content_hash === "string" ? body.content_hash : null,
    ...(tags !== undefined ? { tags } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(recurrence !== undefined ? { recurrence } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };

  let row;
  if (insertValue.localEntryId) {
    [row] = await db
      .insert(memories)
      .values(insertValue)
      .onConflictDoUpdate({
        target: [memories.sessionId, memories.localEntryId],
        targetWhere: sql`${memories.localEntryId} IS NOT NULL`,
        set: {
          title: insertValue.title,
          content: insertValue.content,
          category: insertValue.category,
          contentHash: insertValue.contentHash,
          ...(tags !== undefined ? { tags } : {}),
          ...(confidence !== undefined ? { confidence } : {}),
          ...(recurrence !== undefined ? { recurrence } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();
  } else {
    [row] = await db.insert(memories).values(insertValue).returning();
  }

  return Response.json(row, { status: 201 });
}

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const sessionFilter = url.searchParams.get("session");
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const filters = sessionFilter
    ? eq(memories.sessionId, sessionFilter)
    : undefined;

  if (q && q.trim().length > 0) {
    const term = q.trim();
    const score = sql<number>`(
      similarity(${memories.title}, ${term}) * 2 +
      COALESCE(similarity(${memories.content}, ${term}), 0)
    )`;
    const rows = await db
      .select({
        id: memories.id,
        sessionId: memories.sessionId,
        localEntryId: memories.localEntryId,
        title: memories.title,
        content: memories.content,
        category: memories.category,
        tags: memories.tags,
        confidence: memories.confidence,
        recurrence: memories.recurrence,
        contentHash: memories.contentHash,
        metadata: memories.metadata,
        createdAt: memories.createdAt,
        updatedAt: memories.updatedAt,
        score,
      })
      .from(memories)
      .where(
        filters
          ? and(filters, sql`(${memories.title} % ${term} OR ${memories.content} % ${term})`)
          : sql`(${memories.title} % ${term} OR ${memories.content} % ${term})`
      )
      .orderBy(desc(score))
      .limit(limit);
    return Response.json({ memories: rows, query: term });
  }

  const rows = await db
    .select()
    .from(memories)
    .where(filters)
    .orderBy(desc(memories.createdAt))
    .limit(limit);

  return Response.json({ memories: rows });
}
