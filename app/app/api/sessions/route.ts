import { desc } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { newBearerToken, newSessionId, sha256 } from "@/lib/crypto";
import { isAdminAuthorized } from "@/lib/admin-token";
import { limitHeaders } from "@/lib/rate-limit";
import { sessionCreateSchema } from "@/lib/validate";
import { actorFrom, logAudit, requestIdFrom } from "@/lib/audit";

export async function POST(request: Request) {
  // Session minting is the credential-issuing step — it requires the admin
  // token, same as session deletion. A tailnet member without the token
  // cannot mint API credentials (approvals are operator-gated). Rate limit
  // sits in front of the token compare to blunt brute-force attempts.
  const limited = limitHeaders(request, "sessions-create", 10);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return Response.json(
      { error: "admin token required (X-Admin-Token header)" },
      { status: 401 }
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = sessionCreateSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "name is required (non-empty string, max 200 chars)" },
      { status: 400 }
    );
  }
  const name = parsed.data.name;

  const id = newSessionId();
  const token = newBearerToken();
  const tokenHash = sha256(token);

  const [row] = await db
    .insert(sessions)
    .values({ id, name, tokenHash })
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

export async function GET(request: Request) {
  // Unauthenticated enumeration is by design (tailnet-trust model), but the
  // result set is capped so a growing sessions table can't amplify into
  // unbounded responses.
  const url = new URL(request.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(limitRaw, 500) : 100;

  const rows = await db
    .select({
      id: sessions.id,
      name: sessions.name,
      createdAt: sessions.createdAt,
      lastSeen: sessions.lastSeen,
    })
    .from(sessions)
    .orderBy(desc(sessions.lastSeen))
    .limit(limit);

  return Response.json({ sessions: rows });
}
