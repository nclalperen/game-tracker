import { useEffect, useState } from "react";

const DEV_ENABLED = import.meta.env?.VITE_DEV_INSPECTOR === "1";

type DataInspectorProps = {
  rawTitle?: string | null;
  normalizedTitle?: string;
  identityTitle?: string | null;
  mcKey?: string | null;
};

export function DataInspector({ rawTitle, normalizedTitle, identityTitle, mcKey }: DataInspectorProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!DEV_ENABLED) return;
    const handler = (event: KeyboardEvent) => {
      if (event.altKey && event.ctrlKey && (event.key === "d" || event.key === "D")) {
        event.preventDefault();
        setVisible((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!DEV_ENABLED || !visible) {
    return null;
  }

  return (
    <aside className="mt-4 rounded-md border border-dashed border-zinc-400 bg-white/95 p-3 text-xs text-zinc-700 shadow-sm">
      <div className="font-semibold text-zinc-800">Data Inspector (Ctrl+Alt+D to toggle)</div>
      <dl className="mt-2 space-y-1">
        <div>
          <dt className="font-medium text-zinc-600">Raw title</dt>
          <dd>{rawTitle ?? "(unknown)"}</dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-600">Normalized title</dt>
          <dd>{normalizedTitle ?? "(n/a)"}</dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-600">Identity title</dt>
          <dd>{identityTitle ?? "(n/a)"}</dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-600">Metacritic key</dt>
          <dd>{mcKey ?? "(n/a)"}</dd>
        </div>
      </dl>
    </aside>
  );
}

