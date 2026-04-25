import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ a?: string; b?: string; threshold?: string }>;
}

interface BothPair {
  a_id: string;
  b_id: string;
  a_title: string;
  b_title: string;
  sim: number;
}

interface OnlyRow {
  id: string;
  title: string;
  category: string | null;
}

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
    <main className="mx-auto max-w-6xl px-6 py-12 font-sans">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← all sessions
      </Link>
      <header className="mb-6 mt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Compare sessions</h1>
        <p className="text-sm text-zinc-500">
          See where two sessions overlap and where each has unique knowledge.
          Default similarity threshold is 0.4.
        </p>
      </header>

      <form
        className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto_auto]"
        method="get"
      >
        <SessionPicker
          name="a"
          label="Session A"
          options={allSessions}
          value={a}
        />
        <SessionPicker
          name="b"
          label="Session B"
          options={allSessions}
          value={b}
        />
        <label className="block text-sm">
          <span className="block text-xs font-medium uppercase text-zinc-500">
            threshold
          </span>
          <input
            type="number"
            name="threshold"
            min={0.05}
            max={0.95}
            step={0.05}
            defaultValue={threshold}
            className="mt-1 w-24 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <button
          type="submit"
          className="self-end rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Compare
        </button>
      </form>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!a || !b
        ? !error && (
            <p className="text-sm text-zinc-500">Pick two sessions to compare.</p>
          )
        : null}

      {result && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Bucket
            heading={`Only in ${result.aName}`}
            items={result.inAOnly}
            tone="left"
          />
          <Bucket
            heading="In both"
            items={result.inBoth.map<OnlyRow>((p) => ({
              id: p.a_id,
              title: `${p.a_title}  ↔  ${p.b_title}  · ${(p.sim).toFixed(2)}`,
              category: null,
            }))}
            tone="middle"
          />
          <Bucket
            heading={`Only in ${result.bName}`}
            items={result.inBOnly}
            tone="right"
          />
        </div>
      )}
    </main>
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
    <label className="block text-sm">
      <span className="block text-xs font-medium uppercase text-zinc-500">
        {label}
      </span>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
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
    </label>
  );
}

function Bucket({
  heading,
  items,
  tone,
}: {
  heading: string;
  items: OnlyRow[];
  tone: "left" | "middle" | "right";
}) {
  const headerClass =
    tone === "middle"
      ? "border-zinc-300 dark:border-zinc-700"
      : "border-zinc-200 dark:border-zinc-800";
  return (
    <section className={`rounded-md border ${headerClass} p-4`}>
      <h2 className="mb-3 flex items-baseline justify-between text-sm font-semibold">
        <span>{heading}</span>
        <span className="text-xs font-normal text-zinc-500">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-500">— none —</p>
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <li
              key={m.id}
              className="rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-900"
            >
              <div className="font-medium text-zinc-800 dark:text-zinc-200">
                {m.title}
              </div>
              {m.category && (
                <div className="mt-0.5 text-zinc-500">{m.category}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
