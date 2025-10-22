import { useEffect, useMemo, useState } from "react";
import { db } from "@/db";
import {
  computeSuggestions,
  type Weights,
  type LibraryItem,
  type Identity,
} from "@tracker/core";

/** ---------- weights helpers ---------- */
const DEFAULT_WEIGHTS: Weights = {
  backlogBoost: 1,
  valueWeight: 1,
  scoreWeight: 1,
  durationWeight: 1,
};

function loadWeights(): Weights {
  try {
    const raw = localStorage.getItem("weights");
    if (raw) return JSON.parse(raw) as Weights;
  } catch {}
  return DEFAULT_WEIGHTS;
}

function saveWeights(w: Weights) {
  localStorage.setItem("weights", JSON.stringify(w));
}

/** ---------- page ---------- */
export default function SuggestionsPage() {
  const [weights, setWeights] = useState<Weights>(loadWeights());
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);

  // Load data once
  useEffect(() => {
    (async () => {
      const [lib, idents] = await Promise.all([
        db.library.toArray(),
        db.identities.toArray(),
      ]);
      setItems(lib);
      setIdentities(idents);
    })();
  }, []);

  // Persist weights on change
  useEffect(() => {
    saveWeights(weights);
  }, [weights]);

  // React to weights changed in another tab
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "weights" && e.newValue) {
        try {
          setWeights(JSON.parse(e.newValue) as Weights);
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const idById = useMemo(
    () => new Map(identities.map((i) => [i.id, i] as const)),
    [identities]
  );

  const suggestions = useMemo(
    () => computeSuggestions(items, weights),
    [items, weights]
  );

  const playNext = useMemo(
    () => suggestions.filter((s) => s.kind === "PlayNext").slice(0, 12),
    [suggestions]
  );
  const buyClaim = useMemo(
    () => suggestions.filter((s) => s.kind === "BuyClaim").slice(0, 12),
    [suggestions]
  );

  return (
    <div className="space-y-4">
      {/* Weights card */}
      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Heuristic Weights</h2>
          <button
            className="btn-ghost"
            onClick={() => setWeights(DEFAULT_WEIGHTS)}
            title="Reset to defaults"
          >
            Reset
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <WeightSlider
            label="Backlog boost"
            value={weights.backlogBoost}
            onChange={(v) => setWeights({ ...weights, backlogBoost: v })}
          />
          <WeightSlider
            label="Value (₺/h)"
            value={weights.valueWeight}
            onChange={(v) => setWeights({ ...weights, valueWeight: v })}
          />
          <WeightSlider
            label="OpenCritic score"
            value={weights.scoreWeight}
            onChange={(v) => setWeights({ ...weights, scoreWeight: v })}
          />
          <WeightSlider
            label="Shorter duration"
            value={weights.durationWeight}
            onChange={(v) => setWeights({ ...weights, durationWeight: v })}
          />
        </div>

        <div className="mt-2 text-xs text-zinc-500">
          These run fully offline. Weights are saved to your browser and used
          when ranking suggestions.
        </div>
      </section>

      {/* Play Next */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-700">Play Next</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {playNext.map((s) => {
            const ident = idById.get(s.item.identityId);
            return (
              <article key={s.id} className="card">
                <div className="flex items-start justify-between">
                  <div className="font-medium">
                    {ident?.title || s.item.identityId}
                  </div>
                  <span className="badge">{ident?.platform ?? "—"}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.reason.map((r: string) => (
                    <span key={r} className="badge">
                      {r}
                    </span>
                  ))}
                </div>
                <div className="mt-2 text-xs text-zinc-500">
                  score {Math.round(s.score)}
                </div>
              </article>
            );
          })}
          {playNext.length === 0 && (
            <div className="text-sm text-zinc-500">
              No suggestions yet — add some Backlog items.
            </div>
          )}
        </div>
      </section>

      {/* Buy/Claim */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-700">Buy / Claim</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {buyClaim.map((s) => {
            const ident = idById.get(s.item.identityId);
            return (
              <article key={s.id} className="card">
                <div className="flex items-start justify-between">
                  <div className="font-medium">
                    {ident?.title || s.item.identityId}
                  </div>
                  <span className="badge">{ident?.platform ?? "—"}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.reason.map((r: string) => (
                    <span key={r} className="badge">
                      {r}
                    </span>
                  ))}
                </div>
                <div className="mt-2 text-xs text-zinc-500">
                  score {Math.round(s.score)} · deals: (coming soon)
                </div>
              </article>
            );
          })}
          {buyClaim.length === 0 && (
            <div className="text-sm text-zinc-500">
              Nothing to buy/claim right now.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** ---------- small UI bits ---------- */

function WeightSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-3">
      <div>
        <div className="text-sm">{label}</div>
        <input
          type="range"
          min={0}
          max={3}
          step={0.1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full"
        />
      </div>
      <span className="text-sm tabular-nums w-10 text-right">
        {value.toFixed(1)}
      </span>
    </label>
  );
}
