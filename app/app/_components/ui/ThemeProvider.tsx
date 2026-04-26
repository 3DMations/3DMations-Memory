"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const STORAGE_KEY = "memory-hub:theme";

// External pub/sub so multiple useTheme() callers stay in sync without
// needing a React Context wrapper (which interacts badly with the FOUC-prevention
// inline-script + Next.js client-component boundaries on the html element).
const listeners = new Set<(t: Theme) => void>();

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", t === "dark");
  document.documentElement.classList.toggle("light", t === "light");
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* private mode etc. */
  }
}

export function setThemeGlobal(t: Theme) {
  applyTheme(t);
  listeners.forEach((fn) => fn(t));
}

export function useTheme() {
  // Always start with "dark" on first render to match SSR; the useEffect
  // below reconciles to the real value on the client.
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    setThemeState(readTheme());
    const listener = (t: Theme) => setThemeState(t);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    theme,
    setTheme: setThemeGlobal,
    toggle: () => setThemeGlobal(theme === "dark" ? "light" : "dark"),
  };
}

// Kept exported as a no-op so existing layout.tsx import doesn't break.
// The actual provider role is no longer needed — useTheme manages itself.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
