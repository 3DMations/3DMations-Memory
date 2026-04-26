import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { requireAdmin } from "@/lib/tailscale-identity";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export async function GET(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const rows = await db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return Response.json({
    count: rows.length,
    limit,
    logs: rows,
  });
}
