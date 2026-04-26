"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import IconButton from "./ui/IconButton";
import Button from "./ui/Button";

const ADMIN_KEY = "memory-hub:admin-token";

interface Props {
  sessionId: string;
  sessionName: string;
  memoryCount: number;
}

type Status = "idle" | "deleting" | "error";

export default function SessionDeleteButton({
  sessionId,
  sessionName,
  memoryCount,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [adminToken, setAdminToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const cached = sessionStorage.getItem(ADMIN_KEY);
    if (cached) setAdminToken(cached);
  }, [open]);

  function close() {
    setOpen(false);
    setStatus("idle");
    setError(null);
    setTokenInput("");
  }

  function saveToken() {
    const t = tokenInput.trim();
    if (!t) return;
    sessionStorage.setItem(ADMIN_KEY, t);
    setAdminToken(t);
    setTokenInput("");
  }

  async function performDelete(withMemories: boolean) {
    setStatus("deleting");
    setError(null);
    try {
      const url = new URL(
        `/api/sessions/${sessionId}`,
        window.location.origin
      );
      if (withMemories) url.searchParams.set("with_memories", "true");

      const res = await fetch(url, {
        method: "DELETE",
        headers: { "X-Admin-Token": adminToken },
      });

      if (res.status === 401) {
        sessionStorage.removeItem(ADMIN_KEY);
        setAdminToken("");
        setStatus("error");
        setError("Admin token rejected. Re-enter it.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setStatus("error");
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }

      close();
      router.refresh();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <IconButton
        size="sm"
        label={`Delete session ${sessionName}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="hover:!text-error hover:!bg-error/10"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </IconButton>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface shadow-[var(--shadow-lg)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-text">
              Delete session
            </h2>
            <p className="mt-1.5 text-[13.5px] text-text-muted">
              <span className="font-medium text-text">{sessionName}</span> ·{" "}
              {memoryCount} memor{memoryCount === 1 ? "y" : "ies"}
            </p>

            {!adminToken ? (
              <div className="mt-6 space-y-4">
                <label className="block text-[13px]">
                  <span className="font-medium text-text">Admin token</span>
                  <input
                    type="password"
                    autoFocus
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveToken();
                    }}
                    className="mt-1.5 w-full rounded-[var(--radius-button)] border border-border bg-bg px-3 py-2 font-mono text-[13px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                    placeholder="AUTH_SECRET from .env"
                  />
                  <span className="mt-1.5 block text-[12px] text-text-subtle">
                    Cached for this browser tab only.
                  </span>
                </label>
                <div className="flex gap-2 pt-1">
                  <Button onClick={saveToken} disabled={!tokenInput.trim()}>
                    Continue
                  </Button>
                  <Button variant="outline" onClick={close}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                <p className="text-[13px] text-text-muted">
                  Choose what to do with this session&apos;s memories:
                </p>

                <button
                  type="button"
                  disabled={status === "deleting"}
                  onClick={() => performDelete(false)}
                  className="w-full rounded-[var(--radius-button)] border border-border bg-surface-2/50 px-4 py-3 text-left transition-all hover:border-border-strong hover:bg-surface-2 disabled:opacity-50"
                >
                  <div className="font-medium text-text text-[14px]">
                    Delete session — keep memories
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-text-muted">
                    Memories survive without a session and appear under /orphaned.
                  </div>
                </button>

                <button
                  type="button"
                  disabled={status === "deleting"}
                  onClick={() => performDelete(true)}
                  className="w-full rounded-[var(--radius-button)] border border-error/30 bg-error/10 px-4 py-3 text-left transition-all hover:bg-error/20 hover:border-error/50 disabled:opacity-50"
                >
                  <div className="font-medium text-error text-[14px]">
                    Delete session + all memories
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-error/80">
                    Hard delete. {memoryCount} memor
                    {memoryCount === 1 ? "y" : "ies"} permanently removed.
                  </div>
                </button>

                {error && (
                  <p className="text-[13px] text-error">{error}</p>
                )}

                <div className="flex justify-end pt-2">
                  <Button
                    variant="ghost"
                    onClick={close}
                    disabled={status === "deleting"}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
