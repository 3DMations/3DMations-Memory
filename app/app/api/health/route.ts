import { sql } from "drizzle-orm";
import { db } from "@/db";

export async function GET() {
  try {
    const result = await db.execute<{ ping: number }>(sql`SELECT 1 AS ping`);
    const ping = result.rows[0]?.ping;
    return Response.json({
      status: "ok",
      db: ping === 1 ? "ok" : "degraded",
      schema_version: 1,
    });
  } catch (err) {
    return Response.json(
      {
        status: "error",
        db: "down",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }
}
