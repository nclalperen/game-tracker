import { useEffect, useState } from "react";
import { getTranscripts, clearTranscripts, type AllyTranscript } from "@/db";

type Props = {
  enabled: boolean;
};

export function TranscriptPanel({ enabled }: Props) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AllyTranscript[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const rows = await getTranscripts(20);
      setItems(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const rows = await getTranscripts(20);
        if (!cancelled) {
          setItems(rows);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <section className="card space-y-3 bg-zinc-900 text-zinc-100">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">AI transcripts (dev)</h3>
          <p className="text-xs text-zinc-400">Last 20 exchanges captured locally</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void refresh()}
            disabled={loading}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={async () => {
              await clearTranscripts();
              await refresh();
            }}
            disabled={loading || items.length === 0}
          >
            Clear
          </button>
        </div>
      </header>
      {loading ? <div className="text-xs text-zinc-400">Loading...</div> : null}
      {error ? <div className="text-xs text-rose-400">Failed to load transcripts: {error}</div> : null}
      {items.length === 0 && !loading ? (
        <div className="rounded border border-zinc-700 bg-zinc-800 p-3 text-xs text-zinc-300">
          No transcripts stored (disable in Settings &gt; AI / Ally).
        </div>
      ) : null}
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id ?? item.atISO} className="rounded border border-zinc-700 bg-zinc-800 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-zinc-100">{new Date(item.atISO).toLocaleString()}</span>
              <span className="rounded-full border border-zinc-600 px-2 py-0.5 uppercase tracking-wide text-[10px]">
                {item.mode} {item.allowWeb ? "(web)" : "(local)"}
              </span>
            </div>
            <p className="mt-2 font-mono text-[11px] text-emerald-300">{item.query}</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-zinc-300">View reply JSON</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-zinc-900 p-3 text-[11px] text-zinc-200">
                {JSON.stringify(item.reply, null, 2)}
              </pre>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
