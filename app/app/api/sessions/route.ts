import { desc } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { newBearerToken, newSessionId, sha256 } from "@/lib/crypto";

export async function POST(request: Request) {
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
