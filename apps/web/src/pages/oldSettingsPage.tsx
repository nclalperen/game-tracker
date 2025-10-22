import { useEffect, useState } from "react";
import { clearAllData } from "@/db";

function useToggle(key: string, def = "0") {
  const [v, setV] = useState<string>(() => localStorage.getItem(key) ?? def);
  useEffect(() => { localStorage.setItem(key, v); }, [key, v]);
  return [v === "1", (b: boolean) => setV(b ? "1" : "0")] as const;
}

// helpers
function applyCardSize(size: "small"|"medium"|"large"|"auto") {
  const root = document.documentElement;
  const px = size === "small" ? 240 : size === "large" ? 340 : 280;
  if (size === "auto") {
    root.style.removeProperty("--card-w"); // let CSS decide (but keep min via media if you want)
  } else {
    root.style.setProperty("--card-w", px + "px");
  }
  localStorage.setItem("card_size", size);
}

function applySteamCC(cc: string) {
  localStorage.setItem("steam_cc", cc.toLowerCase());
}

// on mount
useEffect(() => {
  const saved = (localStorage.getItem("card_size") as any) || "medium";
  applyCardSize(saved);
  if (!localStorage.getItem("steam_cc")) localStorage.setItem("steam_cc", "us");
}, []);


let isTauri = false;
try { isTauri = typeof (window as any).__TAURI__ !== "undefined"; } catch {}

export default function SettingsPage() {
  const [coversOn, setCoversOn] = useToggle("covers_enabled", "1");     // default ON
  const [igdbOn,   setIgdbOn]   = useToggle("igdb_enabled", "0");       // default OFF
  const [hltbOn,   setHltbOn]   = useToggle("hltb_enabled", isTauri ? "1" : "0"); // desktop on

  const [cc, setCc] = useState(() => localStorage.getItem("steam_cc") || "tr");
  useEffect(() => { localStorage.setItem("steam_cc", cc); }, [cc]);

  async function clearHLTBCache() {
    if (!isTauri) return alert("HLTB cache is desktop-only.");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("hltb_clear_cache");
      alert("HLTB cache cleared.");
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Integrations</h2>

        <label className="flex items-center gap-3">
          <input type="checkbox" checked={coversOn} onChange={e => setCoversOn(e.target.checked)} />
          <span>Covers (Steam/IGDB URLs)</span>
        </label>

        <label className="flex items-center gap-3">
          <input type="checkbox" checked={igdbOn} onChange={e => setIgdbOn(e.target.checked)} />
          <span>IGDB (TTB & cover id) — mocked until keys</span>
        </label>

        <label className="flex items-center gap-3" title={isTauri ? "" : "Desktop-only (Tauri)"}>
          <input type="checkbox" checked={hltbOn} disabled={!isTauri} onChange={e => setHltbOn(e.target.checked)} />
          <span>HowLongToBeat (desktop)</span>
        </label>

        <div className="flex items-center gap-2">
          <span className="w-40">Steam region:</span>
          <select className="select" value={cc} onChange={e => setCc(e.target.value)}>
            <option value="tr">Turkey (TRY)</option>
            <option value="us">USA (USD)</option>
            <option value="gb">UK (GBP)</option>
            <option value="eu">EU (EUR)</option>
            <option value="ru">Russia (RUB)</option>
            <option value="ar">Argentina (ARS)</option>
          </select>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Data</h2>
        <div className="flex gap-2">
          <button
            className="btn"
            onClick={async () => {
              if (!confirm("Clear all local data (profiles, library, settings)?")) return;
              await clearAllData();
              alert("All data cleared.");
              location.reload();
            }}
          >
            Clear Profile (all local data)
          </button>

          <button className="btn-ghost" disabled={!isTauri} onClick={clearHLTBCache}>
            Clear HLTB Cache (desktop)
          </button>
        </div>
      </section>
      <section className="card p-4 space-y-3">
        <h3 className="font-semibold">Card layout</h3>
        <div className="flex gap-2">
          {["small","medium","large","auto"].map((s) => (
            <button key={s} className="btn-ghost"
              onClick={() => applyCardSize(s as any)}>
              {s[0].toUpperCase()+s.slice(1)}
            </button>
          ))}
        </div>

        <h3 className="font-semibold mt-4">Steam price region</h3>
        <select className="select" defaultValue={localStorage.getItem("steam_cc") || "us"}
          onChange={(e) => applySteamCC(e.target.value)}>
          {["us","gb","de","fr","tr","eu","jp","au"].map((cc) => (
            <option key={cc} value={cc}>{cc.toUpperCase()}</option>
          ))}
        </select>
        <p className="text-xs text-zinc-500">Used when fetching prices in the editor.</p>
      </section>
    </div>
  );
}
