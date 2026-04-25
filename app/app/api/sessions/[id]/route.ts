import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";

interface Params {
  params: Promise<{ id: string }>;
}

// TODO: when real user auth lands (Phase 3+), split admin auth off AUTH_SECRET
// into a dedicated ADMIN_TOKEN env. For Phase 1.6 (single user) the reuse is fine.
function isAdminAuthorized(request: Request): boolean {
  const provided = request.headers.get("x-admin-token");
  const expected = process.env.AUTH_SECRET;
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function DELETE(request: Request, { params }: Params) {
  if (!isAdminAuthorized(request)) {
    return Response.json(
      { error: "admin token required (X-Admin-Token header)" },
      { status: 401 }
    );
  }

  const { id } = await params;
  const url = new URL(request.url);
  const withMemories = url.searchParams.get("with_memories") === "true";

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(eq(memories.sessionId, id));

  let memoriesDeleted = 0;
  if (withMemories && count > 0) {
    await db.delete(memories).where(eq(memories.sessionId, id));
    memoriesDeleted = count;
  }

  const deleted = await db
    .delete(sessions)
    .where(eq(sessions.id, id))
    .returning({ id: sessions.id, name: sessions.name });

  if (deleted.length === 0) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }

  return Response.json({
    deleted: deleted[0].id,
    name: deleted[0].name,
    memories_deleted: memoriesDeleted,
    memories_kept: withMemories ? 0 : count,
  });
}
