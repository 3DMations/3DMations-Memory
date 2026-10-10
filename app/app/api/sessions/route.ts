import { desc } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { newBearerToken, newSessionId, sha256 } from "@/lib/crypto";
import { isAdminAuthorized } from "@/lib/admin-token";
import { actorFrom, logAudit, requestIdFrom } from "@/lib/audit";

export async function POST(request: Request) {
  // Session minting is the credential-issuing step — it requires the admin
  // token, same as session deletion. A tailnet member without the token
  // cannot mint API credentials (approvals are operator-gated).
  if (!isAdminAuthorized(request)) {
    return Response.json(
      { error: "admin token required (X-Admin-Token header)" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const name = (body as { name?: unknown })?.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return Response.json(
      { error: "name is required (non-empty string)" },
      { status: 400 }
    );
  }

  const id = newSessionId();
  const token = newBearerToken();
  const tokenHash = sha256(token);

  const [row] = await db
    .insert(sessions)
    .values({ id, name: name.trim(), tokenHash })
    .returning({
      id: sessions.id,
      name: sessions.name,
      createdAt: sessions.createdAt,
    });

  await logAudit({
    action: "session.create",
    sessionId: row.id,
    diff: { name: row.name },
    requestId: requestIdFrom(request),
    actor: actorFrom(request),
  });

  return Response.json(
    {
      id: row.id,
      name: row.name,
      created_at: row.createdAt,
      token,
      message: "Token shown once. Store it now — it cannot be retrieved later.",
    },
    { status: 201 }
  );
}

export async function GET() {
  const rows = await db
    .select({
      id: sessions.id,
      name: sessions.name,
      createdAt: sessions.createdAt,
      lastSeen: sessions.lastSeen,
    })
    .from(sessions)
    .orderBy(desc(sessions.lastSeen));

  return Response.json({ sessions: rows });
}
