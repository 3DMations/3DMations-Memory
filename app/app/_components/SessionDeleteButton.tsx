"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
      <button
        type="button"
        aria-label={`Delete session ${sessionName}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Delete session</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              <span className="font-medium">{sessionName}</span> ·{" "}
              {memoryCount} memor{memoryCount === 1 ? "y" : "ies"}
            </p>

            {!adminToken ? (
              <div className="mt-6 space-y-3">
                <label className="block text-sm">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    Admin token
                  </span>
                  <input
                    type="password"
                    autoFocus
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveToken();
                    }}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    placeholder="AUTH_SECRET value from .env"
                  />
                  <span className="mt-1 block text-xs text-zinc-500">
                    Cached for this browser tab only.
                  </span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={saveToken}
                    disabled={!tokenInput.trim()}
                    className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  >
                    Continue
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  Choose what to do with this session&apos;s memories:
                </p>
                <button
                  type="button"
                  disabled={status === "deleting"}
                  onClick={() => performDelete(false)}
                  className="w-full rounded-md border border-zinc-300 px-4 py-2 text-left text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <div className="font-medium">
                    Delete session — keep memories
                  </div>
                  <div className="text-xs text-zinc-500">
                    Memories survive without a session and appear under
                    /orphaned.
                  </div>
                </button>
                <button
                  type="button"
                  disabled={status === "deleting"}
                  onClick={() => performDelete(true)}
                  className="w-full rounded-md border border-red-300 bg-red-50 px-4 py-2 text-left text-sm hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950 dark:hover:bg-red-900"
                >
                  <div className="font-medium text-red-700 dark:text-red-300">
                    Delete session + all memories
                  </div>
                  <div className="text-xs text-red-600 dark:text-red-400">
                    Hard delete. {memoryCount} memor
                    {memoryCount === 1 ? "y" : "ies"} permanently removed.
                  </div>
                </button>

                {error && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={status === "deleting"}
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-zinc-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
