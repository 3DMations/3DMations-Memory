"use client";

import { useState, useRef, useEffect } from "react";
import type { MetricDoc } from "./metric-docs";

export default function MetricInfo(doc: MetricDoc) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  return (
    <span ref={wrap} className="relative inline-block">
      <button
        type="button"
        aria-label="About this metric"
        aria-expanded={open}
        // Click is idempotent (always opens). Avoiding a toggle here means
        // hover-then-click — which Playwright simulates and real users often
        // do — doesn't immediately close what hover just opened.
        // Dismiss via click-outside, ESC, or mouseleave on the tooltip.
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onMouseEnter={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[11px] font-semibold leading-none text-text-muted transition-colors hover:text-text hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        i
      </button>
      {open && (
        <div
          role="tooltip"
          onMouseLeave={() => setOpen(false)}
          className="absolute left-0 top-6 z-30 w-72 rounded-[var(--radius-card)] border border-border bg-surface p-3 text-[13.5px] leading-relaxed text-text shadow-[var(--shadow-lg)]"
        >
          <p>
            <span className="font-medium text-text-muted">What:</span> {doc.what}
          </p>
          <p className="mt-1.5">
            <span className="font-medium text-text-muted">Source:</span>{" "}
            <code className="font-mono text-[12.5px] break-all">{doc.source}</code>
          </p>
          <p className="mt-1.5">
            <span className="font-medium text-text-muted">Why:</span> {doc.why}
          </p>
        </div>
      )}
    </span>
  );
}
