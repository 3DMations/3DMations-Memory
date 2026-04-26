import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";
import SearchInput from "./SearchInput";
import PageHeader from "../_components/ui/PageHeader";
import Card from "../_components/ui/Card";
import EmptyState from "../_components/ui/EmptyState";
import StatPill from "../_components/ui/StatPill";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const term = q?.trim() ?? "";

  const score = sql<number>`(
    similarity(${memories.title}, ${term}) * 2 +
    COALESCE(similarity(${memories.content}, ${term}), 0)
  )`;

  const results = term
    ? await db
        .select({
          id: memories.id,
          sessionId: memories.sessionId,
          sessionName: sessions.name,
          title: memories.title,
          content: memories.content,
          category: memories.category,
          tags: memories.tags,
          createdAt: memories.createdAt,
          score,
        })
        .from(memories)
        .leftJoin(sessions, sql`${memories.sessionId} = ${sessions.id}`)
        .where(
          sql`(
            ${memories.title} % ${term}
            OR ${memories.content} % ${term}
            OR ${memories.title} ILIKE ${"%" + term + "%"}
            OR ${memories.content} ILIKE ${"%" + term + "%"}
          )`
        )
        .orderBy(desc(score))
        .limit(50)
    : [];

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 font-sans">
      <PageHeader
        back={
          <Link href="/" className="text-text-muted hover:text-text transition-colors">
            ← all sessions
          </Link>
        }
        title="Search"
        description="Trigram + substring match across every session and orphaned memories."
      />

      <div className="mb-8">
        <SearchInput initial={term} />
      </div>

      {term.length === 0 ? (
        <EmptyState
          title="Type to search"
          description="Results rank by trigram similarity. Best matches surface first."
        />
      ) : results.length === 0 ? (
        <EmptyState
          title={<>No memories match &ldquo;{term}&rdquo;</>}
          description="Try a shorter or differently-spelled term."
        />
      ) : (
        <>
          <div className="mb-3 text-[12.5px] text-text-subtle">
            {results.length} match{results.length === 1 ? "" : "es"}
          </div>
          <ul className="space-y-2.5">
            {results.map((m) => (
              <Card as="li" key={m.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  {m.sessionId ? (
                    <Link
                      href={`/s/${m.sessionId}`}
                      className="font-medium text-text text-[14.5px] leading-snug hover:text-accent transition-colors"
                    >
                      {m.title}
                    </Link>
                  ) : (
                    <span className="font-medium text-text text-[14.5px] leading-snug">
                      {m.title}
                    </span>
                  )}
                  <span className="shrink-0 text-[11px] font-mono text-text-subtle pt-0.5">
                    {(m.score ?? 0).toFixed(2)}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {m.sessionName ? (
                    <Link href={`/s/${m.sessionId}`}>
                      <StatPill tone="accent">{m.sessionName}</StatPill>
                    </Link>
                  ) : (
                    <Link href="/orphaned">
                      <StatPill tone="warning">orphaned</StatPill>
                    </Link>
                  )}
                  {m.category && (
                    <span className="text-[12px] text-text-subtle">
                      · {m.category}
                    </span>
                  )}
                </div>
                {m.content && (
                  <p className="mt-2.5 line-clamp-2 whitespace-pre-wrap text-[13.5px] text-text-muted leading-relaxed">
                    {m.content}
                  </p>
                )}
              </Card>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
