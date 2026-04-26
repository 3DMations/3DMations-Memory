import Link from "next/link";
import { desc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { memories } from "@/db/schema";
import PageHeader from "../_components/ui/PageHeader";
import Card from "../_components/ui/Card";
import EmptyState from "../_components/ui/EmptyState";
import StatPill from "../_components/ui/StatPill";

export const dynamic = "force-dynamic";

export default async function OrphanedPage() {
  const rows = await db
    .select()
    .from(memories)
    .where(isNull(memories.sessionId))
    .orderBy(desc(memories.createdAt))
    .limit(200);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 font-sans">
      <PageHeader
        back={
          <Link href="/" className="text-text-muted hover:text-text transition-colors">
            ← all sessions
          </Link>
        }
        title="Orphaned memories"
        description={
          <>
            {rows.length} memor{rows.length === 1 ? "y" : "ies"} whose session
            was deleted with the keep-memories option. Still searchable; not
            attached to any session view.
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No orphaned memories"
          description="All memories are attached to a session."
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((m) => (
            <Card as="li" key={m.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-medium text-text text-[15px] leading-snug">
                  {m.title}
                </h2>
                {m.category && (
                  <StatPill tone="neutral" className="shrink-0">
                    {m.category}
                  </StatPill>
                )}
              </div>
              {m.content && (
                <p className="mt-2 whitespace-pre-wrap text-[13.5px] text-text-muted leading-relaxed">
                  {m.content}
                </p>
              )}
              {m.tags && m.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m.tags.map((t: string) => (
                    <span
                      key={t}
                      className="inline-flex items-center rounded-[var(--radius-pill)] bg-surface-2 px-2 py-0.5 text-[11.5px] text-text-muted font-mono"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 text-[12px] text-text-subtle font-mono">
                {new Date(m.createdAt!).toISOString().slice(0, 16)} UTC
                {m.localEntryId && <> · local id: {m.localEntryId}</>}
              </div>
            </Card>
          ))}
        </ul>
      )}
    </main>
  );
}
