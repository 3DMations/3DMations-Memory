"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "./ThemeProvider";

function GearIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="fixed right-4 top-4 z-50">
      <button
        type="button"
        aria-label="Settings"
        title="Settings"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-button)] border border-border bg-surface/80 text-text-muted backdrop-blur transition-[background,color,transform] hover:bg-surface-2 hover:text-text active:translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <GearIcon className={open ? "rotate-45 transition-transform" : "transition-transform"} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 w-56 rounded-[var(--radius-card)] border border-border bg-surface p-1.5 shadow-[var(--shadow-lg)]"
        >
          <div className="px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-subtle">
            Theme
          </div>
          <div className="grid grid-cols-2 gap-1 px-1.5 pb-1.5">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={theme === "light"}
              onClick={() => setTheme("light")}
              className={
                "flex items-center justify-center gap-2 rounded-[var(--radius-button)] px-3 py-2 text-[13px] font-medium transition-colors " +
                (theme === "light"
                  ? "bg-accent text-white"
                  : "bg-surface-2 text-text hover:bg-border")
              }
            >
              <SunIcon /> Light
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={theme === "dark"}
              onClick={() => setTheme("dark")}
              className={
                "flex items-center justify-center gap-2 rounded-[var(--radius-button)] px-3 py-2 text-[13px] font-medium transition-colors " +
                (theme === "dark"
                  ? "bg-accent text-white"
                  : "bg-surface-2 text-text hover:bg-border")
              }
            >
              <MoonIcon /> Dark
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
