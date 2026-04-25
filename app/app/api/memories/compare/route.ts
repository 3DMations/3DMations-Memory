import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";
import { authenticate } from "@/lib/auth";

const MAX_PER_BUCKET = 100;
const DEFAULT_THRESHOLD = 0.4;

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const a = url.searchParams.get("a");
  const b = url.searchParams.get("b");
  if (!a || !b) {
    return Response.json(
      { error: "both a and b query parameters required (session ids)" },
      { status: 400 }
    );
  }
  if (a === b) {
    return Response.json(
      { error: "a and b must be different sessions" },
      { status: 400 }
    );
  }

  const thresholdRaw = parseFloat(url.searchParams.get("threshold") ?? "");
  const threshold =
    Number.isFinite(thresholdRaw) && thresholdRaw > 0 && thresholdRaw < 1
      ? thresholdRaw
      : DEFAULT_THRESHOLD;

  const [sessA] = await db.select().from(sessions).where(eq(sessions.id, a));
  const [sessB] = await db.select().from(sessions).where(eq(sessions.id, b));
  if (!sessA || !sessB) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }

  const inBoth = await db.execute<{
    a_id: string;
    b_id: string;
    a_title: string;
    b_title: string;
    sim: number;
  }>(sql`
    SELECT a.id::text AS a_id, b.id::text AS b_id,
           a.title AS a_title, b.title AS b_title,
           similarity(a.title, b.title)::float AS sim
      FROM memories a, memories b
     WHERE a.session_id = ${a}
       AND b.session_id = ${b}
       AND similarity(a.title, b.title) > ${threshold}
     ORDER BY sim DESC
     LIMIT ${MAX_PER_BUCKET}
  `);

  const inAOnly = await db.execute<{
    id: string;
    title: string;
    category: string | null;
    created_at: string;
  }>(sql`
    SELECT a.id::text AS id, a.title, a.category, a.created_at
      FROM memories a
     WHERE a.session_id = ${a}
       AND NOT EXISTS (
         SELECT 1 FROM memories b
          WHERE b.session_id = ${b}
            AND similarity(a.title, b.title) > ${threshold}
       )
     ORDER BY a.created_at DESC
     LIMIT ${MAX_PER_BUCKET}
  `);

  const inBOnly = await db.execute<{
    id: string;
    title: string;
    category: string | null;
    created_at: string;
  }>(sql`
    SELECT b.id::text AS id, b.title, b.category, b.created_at
      FROM memories b
     WHERE b.session_id = ${b}
       AND NOT EXISTS (
         SELECT 1 FROM memories a
          WHERE a.session_id = ${a}
            AND similarity(a.title, b.title) > ${threshold}
       )
     ORDER BY b.created_at DESC
     LIMIT ${MAX_PER_BUCKET}
  `);

  return Response.json({
    a: { id: sessA.id, name: sessA.name },
    b: { id: sessB.id, name: sessB.name },
    threshold,
    in_both: inBoth.rows,
    in_a_only: inAOnly.rows,
    in_b_only: inBOnly.rows,
    counts: {
      in_both: inBoth.rows.length,
      in_a_only: inAOnly.rows.length,
      in_b_only: inBOnly.rows.length,
    },
  });
}
