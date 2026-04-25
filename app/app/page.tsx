import Link from "next/link";
import { desc, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";
import SessionDeleteButton from "./_components/SessionDeleteButton";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const rows = await db
    .select({
      id: sessions.id,
      name: sessions.name,
      createdAt: sessions.createdAt,
      lastSeen: sessions.lastSeen,
      memoryCount: sql<number>`COUNT(${memories.id})::int`,
    })
    .from(sessions)
    .leftJoin(memories, sql`${memories.sessionId} = ${sessions.id}`)
    .groupBy(sessions.id)
    .orderBy(desc(sessions.lastSeen));

  const [{ orphanCount }] = await db
    .select({
      orphanCount: sql<number>`COUNT(*)::int`,
    })
    .from(memories)
    .where(isNull(memories.sessionId));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 font-sans">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Memory Hub
          </h1>
          <p className="text-sm text-zinc-500">
            {rows.length} session{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <Link
            href="/search"
            className="rounded-md border border-zinc-300 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Search
          </Link>
          <Link
            href="/compare"
            className="rounded-md border border-zinc-300 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Compare
          </Link>
          <Link
            href="/new"
            className="rounded-md bg-black px-3 py-2 font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            New session
          </Link>
        </nav>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No sessions yet. Create one to start writing memories.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((s) => (
            <li key={s.id} className="flex items-start gap-2 py-4">
              <Link
                href={`/s/${s.id}`}
                className="block flex-1 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-md -mx-2 px-2 py-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-zinc-500">
                    {s.memoryCount} memor{s.memoryCount === 1 ? "y" : "ies"}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                  <code className="font-mono">{s.id}</code>
                  <span>·</span>
                  <span>last seen {formatDate(s.lastSeen)}</span>
                </div>
              </Link>
              <SessionDeleteButton
                sessionId={s.id}
                sessionName={s.name}
                memoryCount={s.memoryCount}
              />
            </li>
          ))}
        </ul>
      )}

      {orphanCount > 0 && (
        <div className="mt-8 rounded-md border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <Link
            href="/orphaned"
            className="flex items-center justify-between hover:underline"
          >
            <span>Orphaned memories</span>
            <span className="text-zinc-500">
              {orphanCount} memor{orphanCount === 1 ? "y" : "ies"} →
            </span>
          </Link>
        </div>
      )}
    </main>
  );
}

function formatDate(d: Date | null): string {
  if (!d) return "never";
  return new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
