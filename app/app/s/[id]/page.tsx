import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}

export default async function SessionDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { q } = await searchParams;

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);

  if (!session) notFound();

  const term = q?.trim();
  const rows = term
    ? await db
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.sessionId, id),
            sql`(${memories.title} % ${term} OR ${memories.content} % ${term})`
          )
        )
        .orderBy(
          desc(
            sql`(similarity(${memories.title}, ${term}) * 2 + COALESCE(similarity(${memories.content}, ${term}), 0))`
          )
        )
        .limit(50)
    : await db
        .select()
        .from(memories)
        .where(eq(memories.sessionId, id))
        .orderBy(desc(memories.createdAt))
        .limit(50);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 font-sans">
      <Link
        href="/"
        className="text-sm text-zinc-500 hover:underline"
      >
        ← all sessions
      </Link>
      <header className="mb-8 mt-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {session.name}
        </h1>
        <p className="text-xs font-mono text-zinc-500">{session.id}</p>
      </header>

      <form className="mb-6">
        <input
          type="text"
          name="q"
          defaultValue={term ?? ""}
          placeholder="search memories…"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {term
            ? `No memories match "${term}".`
            : "No memories in this session yet."}
        </p>
      ) : (
        <ul className="space-y-4">
          {rows.map((m) => (
            <li
              key={m.id}
              className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{m.title}</h2>
                {m.category && (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {m.category}
                  </span>
                )}
              </div>
              {m.content && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                  {m.content}
                </p>
              )}
              {m.tags && m.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.tags.map((t: string) => (
                    <span
                      key={t}
                      className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 text-xs text-zinc-500">
                {new Date(m.createdAt!).toISOString().slice(0, 16)} UTC
                {m.localEntryId && <> · local id: {m.localEntryId}</>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
