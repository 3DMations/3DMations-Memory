"use client";

import Link from "next/link";
import { useState } from "react";
import PageHeader from "../_components/ui/PageHeader";
import Card from "../_components/ui/Card";
import Button from "../_components/ui/Button";
import { ADMIN_KEY } from "@/lib/admin-key";

interface CreatedSession {
  id: string;
  name: string;
  token: string;
}

export default function NewSessionPage() {
  const [name, setName] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [created, setCreated] = useState<CreatedSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": adminToken,
        },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (res.status === 401) {
        sessionStorage.removeItem(ADMIN_KEY);
        setAdminToken("");
        setError("Admin token rejected. Re-enter it.");
      } else if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        sessionStorage.setItem(ADMIN_KEY, adminToken);
        setCreated({ id: data.id, name: data.name, token: data.token });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  if (created) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-12 font-sans">
        <PageHeader
          title="Session created"
          description={
            <span className="text-warning">
              ⚠ Save this token now. It will not be shown again.
            </span>
          }
        />

        <Card className="px-5 py-5">
          <dl className="space-y-4">
            <Row label="Session ID">
              <code className="font-mono text-text">{created.id}</code>
            </Row>
            <Row label="Name">
              <span className="text-text">{created.name}</span>
            </Row>
            <Row label="Bearer token">
              <div className="flex items-start gap-2">
                <code className="flex-1 break-all rounded-[var(--radius-button)] bg-bg border border-border p-3 font-mono text-[14px] text-text">
                  {created.token}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToken(created.token)}
                  type="button"
                  className="shrink-0"
                >
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
            </Row>
          </dl>
        </Card>

        <div className="mt-6 flex gap-2">
          <Link href={`/s/${created.id}`}>
            <Button>Open session</Button>
          </Link>
          <Link href="/">
            <Button variant="outline">All sessions</Button>
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-12 font-sans">
      <PageHeader
        back={
          <Link href="/" className="text-text-muted hover:text-text transition-colors">
            ← all sessions
          </Link>
        }
        title="New session"
        description="A session represents one machine or one Claude Code workspace."
      />

      <Card className="px-5 py-5">
        <form onSubmit={onSubmit} className="space-y-5">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              Session name
            </span>
            <input
              type="text"
              required
              minLength={1}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="inspiron-myproject"
              className="w-full rounded-[var(--radius-button)] border border-border bg-bg px-3 py-2.5 text-[16px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors"
            />
            <span className="mt-1.5 block text-[14px] text-text-subtle">
              Convention: <code className="font-mono">{`<machine>-<project>`}</code>
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              Admin token
            </span>
            <input
              type="password"
              required
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              autoComplete="off"
              placeholder="AUTH_SECRET — approves a new device"
              className="w-full rounded-[var(--radius-button)] border border-border bg-bg px-3 py-2.5 text-[16px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors"
            />
            <span className="mt-1.5 block text-[14px] text-text-subtle">
              Minting sessions is operator-gated (hub <code className="font-mono">AUTH_SECRET</code>).
            </span>
          </label>

          {error && (
            <div className="rounded-[var(--radius-button)] border border-error/30 bg-error/10 px-3 py-2 text-[15px] text-error">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={
              submitting || name.trim().length === 0 || adminToken.length === 0
            }
          >
            {submitting ? "Creating…" : "Create session"}
          </Button>
        </form>
      </Card>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] font-semibold uppercase tracking-[0.06em] text-text-muted">
        {label}
      </dt>
      <dd className="mt-1.5 text-[16px]">{children}</dd>
    </div>
  );
}
