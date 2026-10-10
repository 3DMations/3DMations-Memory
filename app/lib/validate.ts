import { z } from "zod";

// Shared request validation (audit 2026-10-10: previously hand-rolled with no
// length limits — a multi-MB body was persisted verbatim). Bounds chosen to be
// generous for real memory entries while rejecting junk/abuse payloads.

const trimmedNonEmpty = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(max));

export const sessionCreateSchema = z.object({
  name: trimmedNonEmpty(200),
});

export const memoryCreateSchema = z.object({
  session_id: z.string().min(1).max(64),
  title: trimmedNonEmpty(500),
  content: z.string().max(20_000).nullish(),
  category: z.string().max(100).nullish(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  confidence: z.number().min(0).max(1).optional(),
  recurrence: z.number().int().min(1).max(1_000_000).optional(),
  local_entry_id: z.string().min(1).max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SessionCreateBody = z.infer<typeof sessionCreateSchema>;
export type MemoryCreateBody = z.infer<typeof memoryCreateSchema>;

// ILIKE pattern escaping (audit 2026-10-10: user terms were interpolated into
// %…% patterns unescaped — not SQL injection since parameterized, but a term
// like "%_____%" forces wide scans). Escape the three pattern metacharacters;
// the trigram % operator path is unaffected.
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Search terms are additionally capped — protects both the trigram scorer and
// the ILIKE pattern from oversized input.
export const MAX_SEARCH_TERM = 200;