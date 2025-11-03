import { useTheme, toggleTheme } from "@/state/theme";

function MoonIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="text-current"
    >
      <path
        fill="currentColor"
        d="M21 14.25A8.25 8.25 0 0 1 9.75 3a7 7 0 0 0 0 14A8.25 8.25 0 0 0 21 14.25Z"
      />
    </svg>
  );
}

function SunIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="text-current"
    >
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <line x1="12" y1="3" x2="12" y2="1.5" />
        <line x1="12" y1="22.5" x2="12" y2="21" />
        <line x1="4.22" y1="4.22" x2="3.15" y2="3.15" />
        <line x1="20.85" y1="20.85" x2="19.78" y2="19.78" />
        <line x1="3" y1="12" x2="1.5" y2="12" />
        <line x1="22.5" y1="12" x2="21" y2="12" />
        <line x1="4.22" y1="19.78" x2="3.15" y2="20.85" />
        <line x1="20.85" y1="3.15" x2="19.78" y2="4.22" />
      </g>
    </svg>
  );
}

export default function ThemeToggle(): JSX.Element {
  const theme = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-emerald-300 hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-emerald-400 dark:hover:text-emerald-300"
      onClick={toggleTheme}
      aria-pressed={isDark}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
      <span>{isDark ? "Night" : "Day"}</span>
    </button>
  );
}
