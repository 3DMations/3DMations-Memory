"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function SearchInput({ initial }: { initial: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      const trimmed = value.trim();
      if (trimmed.length === 0) params.delete("q");
      else params.set("q", trimmed);
      const qs = params.toString();
      router.replace(qs ? `/search?${qs}` : "/search");
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, router, sp]);

  return (
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
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search across all sessions…"
        className="w-full rounded-[var(--radius-button)] border border-border bg-surface pl-10 pr-3.5 py-2.5 text-[14px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors"
      />
    </div>
  );
}
