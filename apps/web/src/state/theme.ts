import { useSyncExternalStore } from "react";

export type ThemeName = "light" | "dark";

const STORAGE_KEY = "gt.theme";

let currentTheme: ThemeName = "light";
const listeners = new Set<() => void>();
let mediaQuery: MediaQueryList | null = null;

function emit() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  });
}

function applyTheme(theme: ThemeName) {
  currentTheme = theme;
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }
  emit();
}

function detectInitialTheme(): ThemeName {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "light";
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // ignore storage read errors
  }
  if (window.matchMedia) {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    if (mediaQuery.matches) {
      return "dark";
    }
  }
  return "light";
}

if (typeof window !== "undefined") {
  const initial = detectInitialTheme();
  applyTheme(initial);
  if (!mediaQuery && window.matchMedia) {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  }
  if (mediaQuery) {
    const listener = (event: MediaQueryListEvent) => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeName | null;
        if (stored === "light" || stored === "dark") {
          return;
        }
      } catch {
        // ignore storage read errors
      }
      applyTheme(event.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", listener);
  }
}

export function setTheme(theme: ThemeName) {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore storage write errors
  }
  applyTheme(theme);
}

export function toggleTheme() {
  setTheme(currentTheme === "dark" ? "light" : "dark");
}

export function useTheme(): ThemeName {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => currentTheme,
  );
}
