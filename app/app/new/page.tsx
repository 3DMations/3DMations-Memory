"use client";

import Link from "next/link";
import { useState } from "react";

interface CreatedSession {
  id: string;
  name: string;
  token: string;
}

export default function NewSessionPage() {
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setCreated({ id: data.id, name: data.name, token: data.token });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12 font-sans">
        <h1 className="text-2xl font-semibold tracking-tight">
          Session created
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Save this token now. It will not be shown again.
        </p>

        <dl className="mt-6 space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">
              Session ID
            </dt>
            <dd className="mt-1 font-mono">{created.id}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">
              Name
            </dt>
            <dd className="mt-1">{created.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">
              Bearer token
            </dt>
            <dd className="mt-1 break-all rounded bg-white p-2 font-mono text-xs dark:bg-zinc-950">
              {created.token}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex gap-3">
          <Link
            href={`/s/${created.id}`}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Open session
          </Link>
          <Link
            href="/"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
          >
            All sessions
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12 font-sans">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← all sessions
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        New session
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        A session represents one machine or one Claude Code workspace.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <label className="block text-sm">
          <span className="text-zinc-700 dark:text-zinc-300">Name</span>
          <input
            type="text"
            required
            minLength={1}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="macbook-work-2026"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting || name.trim().length === 0}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {submitting ? "Creating…" : "Create session"}
        </button>
      </form>
    </main>
  );
}
