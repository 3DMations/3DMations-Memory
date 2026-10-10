import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";
import { isAdminAuthorized } from "@/lib/admin-token";
import { actorFrom, logAudit, requestIdFrom } from "@/lib/audit";

interface Params {
  params: Promise<{ id: string }>;
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

  await logAudit({
    action: "session.delete",
    sessionId: null, // session row is gone; setting null avoids FK violation
    diff: {
      session_id: deleted[0].id,
      session_name: deleted[0].name,
      memories_deleted: memoriesDeleted,
      memories_kept: withMemories ? 0 : count,
      with_memories: withMemories,
    },
    requestId: requestIdFrom(request),
    actor: actorFrom(request),
  });

  return Response.json({
    deleted: deleted[0].id,
    name: deleted[0].name,
    memories_deleted: memoriesDeleted,
    memories_kept: withMemories ? 0 : count,
  });
}
