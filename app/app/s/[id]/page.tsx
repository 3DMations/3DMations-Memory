import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";
import PageHeader from "../../_components/ui/PageHeader";
import Card from "../../_components/ui/Card";
import EmptyState from "../../_components/ui/EmptyState";
import StatPill from "../../_components/ui/StatPill";

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
    <main className="mx-auto w-full max-w-3xl px-6 py-12 font-sans">
      <PageHeader
        back={
          <Link href="/" className="text-text-muted hover:text-text transition-colors">
            ← all sessions
          </Link>
        }
        title={session.name}
        description={
          <code className="font-mono text-[12px] text-text-subtle">{session.id}</code>
        }
      />

      <form className="mb-8">
        <div className="relative">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            name="q"
            defaultValue={term ?? ""}
            placeholder="Search memories in this session…"
            className="w-full rounded-[var(--radius-button)] border border-border bg-surface pl-10 pr-3.5 py-2.5 text-[14px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors"
          />
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={term ? <>No memories match &ldquo;{term}&rdquo;</> : "No memories yet"}
          description={
            term
              ? "Try a shorter or differently-spelled term."
              : "Memories written by Claude Code with this session's bearer token will appear here."
          }
        />
      ) : (
        <>
          <div className="mb-3 text-[12.5px] text-text-subtle">
            {rows.length} memor{rows.length === 1 ? "y" : "ies"}
            {term ? ` matching "${term}"` : ""}
          </div>
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
        </>
      )}
    </main>
  );
}
