import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import PageHeader from "../_components/ui/PageHeader";
import Card from "../_components/ui/Card";
import StatPill from "../_components/ui/StatPill";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ a?: string; b?: string; threshold?: string }>;
}

// drizzle's db.execute<T> requires T extends Record<string, unknown>.
type BothPair = Record<string, unknown> & {
  a_id: string;
  b_id: string;
  a_title: string;
  b_title: string;
  sim: number;
};

type OnlyRow = Record<string, unknown> & {
  id: string;
  title: string;
  category: string | null;
};

export default async function ComparePage({ searchParams }: PageProps) {
  const { a, b, threshold: thrParam } = await searchParams;

  const thresholdRaw = parseFloat(thrParam ?? "");
  const threshold =
    Number.isFinite(thresholdRaw) && thresholdRaw > 0 && thresholdRaw < 1
      ? thresholdRaw
      : 0.4;

  const allSessions = await db
    .select({ id: sessions.id, name: sessions.name })
    .from(sessions)
    .orderBy(desc(sessions.lastSeen));

  let result: {
    aName: string;
    bName: string;
    inBoth: BothPair[];
    inAOnly: OnlyRow[];
    inBOnly: OnlyRow[];
  } | null = null;
  let error: string | null = null;

  if (a && b) {
    if (a === b) {
      error = "Pick two different sessions.";
    } else {
      const sessA = allSessions.find((s) => s.id === a);
      const sessB = allSessions.find((s) => s.id === b);
      if (!sessA || !sessB) {
        error = "One of the selected sessions doesn't exist.";
      } else {
        const both = await db.execute<BothPair>(sql`
          SELECT a.id::text AS a_id, b.id::text AS b_id,
                 a.title AS a_title, b.title AS b_title,
                 similarity(a.title, b.title)::float AS sim
            FROM memories a, memories b
           WHERE a.session_id = ${a}
             AND b.session_id = ${b}
             AND similarity(a.title, b.title) > ${threshold}
           ORDER BY sim DESC
           LIMIT 100
        `);
        const aOnly = await db.execute<OnlyRow>(sql`
          SELECT a.id::text AS id, a.title, a.category
            FROM memories a
           WHERE a.session_id = ${a}
             AND NOT EXISTS (
               SELECT 1 FROM memories b
                WHERE b.session_id = ${b}
                  AND similarity(a.title, b.title) > ${threshold}
             )
           ORDER BY a.created_at DESC
           LIMIT 100
        `);
        const bOnly = await db.execute<OnlyRow>(sql`
          SELECT b.id::text AS id, b.title, b.category
            FROM memories b
           WHERE b.session_id = ${b}
             AND NOT EXISTS (
               SELECT 1 FROM memories a
                WHERE a.session_id = ${a}
                  AND similarity(a.title, b.title) > ${threshold}
             )
           ORDER BY b.created_at DESC
           LIMIT 100
        `);
        result = {
          aName: sessA.name,
          bName: sessB.name,
          inBoth: both.rows,
          inAOnly: aOnly.rows,
          inBOnly: bOnly.rows,
        };
      }
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 font-sans">
      <PageHeader
        back={
          <Link href="/" className="text-text-muted hover:text-text transition-colors">
            ← all sessions
          </Link>
        }
        title="Compare sessions"
        description="See where two sessions overlap and where each has unique knowledge. Default similarity threshold is 0.4."
      />

      <Card className="mb-8 px-5 py-5">
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
          method="get"
        >
          <SessionPicker name="a" label="Session A" options={allSessions} value={a} />
          <SessionPicker name="b" label="Session B" options={allSessions} value={b} />
          <FieldLabel label="Threshold">
            <input
              type="number"
              name="threshold"
              min={0.05}
              max={0.95}
              step={0.05}
              defaultValue={threshold}
              className="w-24 rounded-[var(--radius-button)] border border-border bg-bg px-3 py-2 text-[14px] text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </FieldLabel>
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-[var(--radius-button)] bg-accent px-5 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Compare
          </button>
        </form>
      </Card>

      {error && (
        <div className="mb-6 rounded-[var(--radius-card)] border border-error/30 bg-error/10 px-4 py-3 text-[13.5px] text-error">
          {error}
        </div>
      )}

      {!a || !b
        ? !error && (
            <p className="text-[13.5px] text-text-muted">
              Pick two sessions and click Compare.
            </p>
          )
        : null}

      {result && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Bucket heading={`Only in ${result.aName}`} items={result.inAOnly} tone="accent" />
          <Bucket
            heading="In both"
            items={result.inBoth.map<OnlyRow>((p) => ({
              id: p.a_id,
              title: `${p.a_title}  ↔  ${p.b_title}  · ${p.sim.toFixed(2)}`,
              category: null,
            }))}
            tone="success"
          />
          <Bucket heading={`Only in ${result.bName}`} items={result.inBOnly} tone="accent" />
        </div>
      )}
    </main>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function SessionPicker({
  name,
  label,
  options,
  value,
}: {
  name: string;
  label: string;
  options: Array<{ id: string; name: string }>;
  value?: string;
}) {
  return (
    <FieldLabel label={label}>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="w-full rounded-[var(--radius-button)] border border-border bg-bg px-3 py-2 text-[14px] text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
      >
        <option value="" disabled>
          Pick a session…
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </FieldLabel>
  );
}

function Bucket({
  heading,
  items,
  tone,
}: {
  heading: string;
  items: OnlyRow[];
  tone: "accent" | "success";
}) {
  return (
    <Card as="section" className="px-5 py-5">
      <h2 className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] font-semibold text-text leading-tight">
          {heading}
        </span>
        <StatPill tone={tone}>{items.length}</StatPill>
      </h2>
      {items.length === 0 ? (
        <p className="text-[12px] text-text-subtle">— none —</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((m) => (
            <li
              key={m.id}
              className="rounded-[var(--radius-button)] bg-surface-2 px-2.5 py-2 text-[12.5px] leading-snug"
            >
              <div className="font-medium text-text">{m.title}</div>
              {m.category && (
                <div className="mt-0.5 text-[11px] text-text-subtle">{m.category}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
