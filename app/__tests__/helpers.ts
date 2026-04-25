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
  // Cascade delete: nuke memories first (FK is now SET NULL, so direct cascade
  // doesn't drop them), then sessions. Also cleans orphans this prefix produced.
  await db.execute(
    sql`DELETE FROM memories WHERE session_id IN (SELECT id FROM sessions WHERE name LIKE ${prefix + "%"})`
  );
  await db.execute(sql`DELETE FROM sessions WHERE name LIKE ${prefix + "%"}`);
}

export const ADMIN_TOKEN = process.env.AUTH_SECRET ?? "";

export async function deleteSession(
  id: string,
  opts: { adminToken?: string; withMemories?: boolean } = {}
): Promise<Response> {
  const url = new URL(`${BASE_URL}/api/sessions/${id}`);
  if (opts.withMemories) url.searchParams.set("with_memories", "true");
  return fetch(url, {
    method: "DELETE",
    headers: opts.adminToken ? { "X-Admin-Token": opts.adminToken } : {},
  });
}
