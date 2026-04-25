import { sha256 } from "@/lib/crypto";

// Fields covered by content_hash. Mutating any of these without recomputing
// will surface as drift in /api/memories/verify.
export interface HashableMemory {
  title: string;
  content: string | null;
  category: string | null;
}

// Stable canonical form: fixed key order, no whitespace, nulls preserved.
// JSON.stringify is deterministic given a fixed key list.
export function canonicalize(m: HashableMemory): string {
  return JSON.stringify({
    title: m.title,
    content: m.content,
    category: m.category,
  });
}

export function computeMemoryHash(m: HashableMemory): string {
  return sha256(canonicalize(m));
}
