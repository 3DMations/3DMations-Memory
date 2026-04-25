import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, type Session } from "@/db/schema";
import { safeEqualHex, sha256 } from "./crypto";

export type AuthResult =
  | { ok: true; session: Session }
  | { ok: false; status: 401 | 403; error: string };

export function extractBearer(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/.exec(auth);
  return m ? m[1].trim() : null;
}

export async function authenticate(
  req: Request,
  requiredSessionId?: string
): Promise<AuthResult> {
  const token = extractBearer(req);
  if (!token) return { ok: false, status: 401, error: "missing bearer token" };

  const provided = sha256(token);
  const candidates = await db.select().from(sessions);

  let session: Session | undefined;
  for (const s of candidates) {
    if (safeEqualHex(s.tokenHash, provided)) {
      session = s;
      break;
    }
  }

  if (!session) return { ok: false, status: 401, error: "invalid token" };

  if (requiredSessionId && session.id !== requiredSessionId) {
    return { ok: false, status: 403, error: "token does not match session" };
  }

  await db
    .update(sessions)
    .set({ lastSeen: new Date() })
    .where(eq(sessions.id, session.id));

  return { ok: true, session };
}
