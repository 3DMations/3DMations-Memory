import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";
import SearchInput from "./SearchInput";

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
    <main className="mx-auto max-w-3xl px-6 py-12 font-sans">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← all sessions
      </Link>
      <header className="mb-6 mt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-zinc-500">
          Trigram + substring match across every session and orphaned memories.
        </p>
      </header>

      <div className="mb-6">
        <SearchInput initial={term} />
      </div>

      {term.length === 0 ? (
        <p className="text-sm text-zinc-500">Type to search.</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No memories match &quot;{term}&quot;.
        </p>
      ) : (
        <ul className="space-y-3">
          {results.map((m) => (
            <li
              key={m.id}
              className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <div className="flex items-center justify-between gap-2">
                {m.sessionId ? (
                  <Link
                    href={`/s/${m.sessionId}`}
                    className="font-medium hover:underline"
                  >
                    {m.title}
                  </Link>
                ) : (
                  <span className="font-medium">{m.title}</span>
                )}
                <span className="shrink-0 text-xs text-zinc-500">
                  {(m.score ?? 0).toFixed(2)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                {m.sessionName ? (
                  <Link
                    href={`/s/${m.sessionId}`}
                    className="rounded-full bg-zinc-100 px-2 py-0.5 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                  >
                    {m.sessionName}
                  </Link>
                ) : (
                  <Link
                    href="/orphaned"
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300"
                  >
                    orphaned
                  </Link>
                )}
                {m.category && <span>· {m.category}</span>}
              </div>
              {m.content && (
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                  {m.content}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
