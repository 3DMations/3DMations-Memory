import Link from "next/link";
import { desc, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";
import SessionDeleteButton from "./_components/SessionDeleteButton";
import PageHeader from "./_components/ui/PageHeader";
import Card from "./_components/ui/Card";
import EmptyState from "./_components/ui/EmptyState";
import StatPill from "./_components/ui/StatPill";

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
    .select({ orphanCount: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(isNull(memories.sessionId));

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 font-sans">
      <PageHeader
        title="Memory Hub"
        description={
          <>
            {rows.length} session{rows.length === 1 ? "" : "s"} ·{" "}
            {rows.reduce((acc, r) => acc + r.memoryCount, 0)} memor
            {rows.reduce((acc, r) => acc + r.memoryCount, 0) === 1 ? "y" : "ies"}
          </>
        }
        actions={
          <>
            <NavLink href="/search">Search</NavLink>
            <NavLink href="/compare">Compare</NavLink>
            <NavLink href="/new" primary>
              + New session
            </NavLink>
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          description="Create one to start writing memories from any tailnet machine."
          action={<NavLink href="/new" primary>+ New session</NavLink>}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <Card as="li" key={s.id} className="flex items-stretch overflow-hidden">
              <Link
                href={`/s/${s.id}`}
                className="block flex-1 px-5 py-4 hover:bg-surface-2/60 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-text truncate">{s.name}</span>
                  <StatPill tone="accent">
                    {s.memoryCount} memor{s.memoryCount === 1 ? "y" : "ies"}
                  </StatPill>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[12px] text-text-subtle">
                  <code className="font-mono text-text-muted">{s.id}</code>
                  <span aria-hidden>·</span>
                  <span>last seen {formatDate(s.lastSeen)}</span>
                </div>
              </Link>
              <div className="flex items-center pr-3">
                <SessionDeleteButton
                  sessionId={s.id}
                  sessionName={s.name}
                  memoryCount={s.memoryCount}
                />
              </div>
            </Card>
          ))}
        </ul>
      )}

      {orphanCount > 0 && (
        <Card as="div" interactive className="mt-8">
          <Link
            href="/orphaned"
            className="flex items-center justify-between gap-3 px-5 py-4"
          >
            <div>
              <div className="font-medium text-text">Orphaned memories</div>
              <div className="text-[12px] text-text-subtle">
                Memories whose session was deleted with the keep-memories option
              </div>
            </div>
            <div className="flex items-center gap-2 text-text-muted">
              <StatPill tone="warning">
                {orphanCount} memor{orphanCount === 1 ? "y" : "ies"}
              </StatPill>
              <span aria-hidden>→</span>
            </div>
          </Link>
        </Card>
      )}
    </main>
  );
}

function NavLink({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  const base =
    "inline-flex items-center h-10 rounded-[var(--radius-button)] px-3.5 text-[13.5px] font-medium transition-colors";
  const cls = primary
    ? `${base} bg-accent text-white hover:bg-accent-hover`
    : `${base} bg-transparent text-text border border-border hover:bg-surface-2 hover:border-border-strong`;
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

function formatDate(d: Date | null): string {
  if (!d) return "never";
  return new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
