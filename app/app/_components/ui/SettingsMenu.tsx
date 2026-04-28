"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "./ThemeProvider";

function HamburgerIcon({ className = "" }: { className?: string }) {
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
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/search", label: "Search" },
  { href: "/compare", label: "Compare" },
  { href: "/stats", label: "Stats" },
  { href: "/gotchas", label: "Gotchas" },
  { href: "/systemhealth", label: "System health" },
];

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
        aria-label="Menu"
        title="Menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-button)] border border-border bg-surface/80 text-text-muted backdrop-blur transition-[background,color,transform] hover:bg-surface-2 hover:text-text active:translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <HamburgerIcon />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 w-40 rounded-[var(--radius-card)] border border-border bg-surface p-1 shadow-[var(--shadow-lg)]"
        >
          <div className="flex justify-center py-1">
            <button
              type="button"
              role="switch"
              aria-checked={theme === "dark"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="relative inline-flex h-7 w-14 items-center rounded-full border border-border bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1.5 flex h-4 w-4 items-center justify-center text-warning"
              >
                <SunIcon />
              </span>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-1.5 flex h-4 w-4 items-center justify-center text-text-muted"
              >
                <MoonIcon />
              </span>
              <span
                aria-hidden="true"
                className={
                  "inline-block h-5 w-5 transform rounded-full bg-warning shadow transition-transform " +
                  (theme === "dark" ? "translate-x-[34px]" : "translate-x-[2px]")
                }
              />
            </button>
          </div>
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="block rounded-[var(--radius-button)] px-2 py-1.5 text-center text-[15px] font-medium text-text hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
