import { db } from "@/db";
import { memories } from "@/db/schema";
import { computeMemoryHash } from "@/lib/hash";
import { requireAdmin } from "@/lib/tailscale-identity";

interface DriftEntry {
  id: string;
  stored_hash: string;
  recomputed_hash: string;
}

export async function GET(request: Request) {
  const auth = requireAdmin(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      content: memories.content,
      category: memories.category,
      contentHash: memories.contentHash,
    })
    .from(memories);

  let ok = 0;
  let unhashed = 0;
  const drift: DriftEntry[] = [];

  for (const row of rows) {
    if (row.contentHash === null) {
      unhashed++;
      continue;
    }
    const recomputed = computeMemoryHash({
      title: row.title,
      content: row.content,
      category: row.category,
    });
    if (recomputed === row.contentHash) {
      ok++;
    } else {
      drift.push({
        id: row.id,
        stored_hash: row.contentHash,
        recomputed_hash: recomputed,
      });
    }
  }

  const status = drift.length > 0 ? 409 : 200;
  return Response.json(
    {
      checked: rows.length,
      ok,
      unhashed,
      drift,
    },
    { status },
  );
}
