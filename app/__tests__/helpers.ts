import { sql } from "drizzle-orm";
import { db } from "@/db";

export const BASE_URL = process.env.HUB_BASE_URL ?? "http://localhost:3000";

export async function createSession(name: string): Promise<{
  id: string;
  token: string;
}> {
  const res = await fetch(`${BASE_URL}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`createSession failed: HTTP ${res.status}`);
  const data = await res.json();
  return { id: data.id, token: data.token };
}

export async function cleanupTestSessions(prefix: string): Promise<void> {
  await db.execute(sql`DELETE FROM sessions WHERE name LIKE ${prefix + "%"}`);
}
