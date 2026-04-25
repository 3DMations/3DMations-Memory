import Link from "next/link";
import { desc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { memories } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function OrphanedPage() {
  const rows = await db
    .select()
    .from(memories)
    .where(isNull(memories.sessionId))
    .orderBy(desc(memories.createdAt))
    .limit(200);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 font-sans">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← all sessions
      </Link>
      <header className="mb-8 mt-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Orphaned memories
        </h1>
        <p className="text-sm text-zinc-500">
          {rows.length} memor{rows.length === 1 ? "y" : "ies"} whose session
          was deleted with the keep-memories option. Still searchable; not
          attached to any session view.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No orphaned memories.
        </div>
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
