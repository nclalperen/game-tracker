import { useState, useEffect } from "react";
import { clearAllData } from "@/db";
import { db } from "@/db";
import { fetchHLTB, fetchSteamPrice, fetchOpenCriticScore, isTauri } from "@/desktop/bridge";

/**
 * Settings page for Game Tracker.  This component allows users to toggle
 * integrations, adjust card layout, and choose the Steam region for price
 * fetching.  All preferences are persisted in localStorage and applied on
 * first mount.  Hooks are used exclusively inside the component body to
 * satisfy React’s rules of hooks.
 */
export default function SettingsPage() {
  // Set the card width to a fixed 340px ("Large" size) on mount.  The user can no
  // longer choose between sizes.  We persist this for completeness, although
  // there is no UI to change it.
  useEffect(() => {
    document.documentElement.style.setProperty("--card-w", `340px`);
    localStorage.setItem("card_size", "large");
  }, []);

  /**
   * Steam region selection.  Determines which country code will be used when
   * fetching prices.  Defaults to "us".  Persist to localStorage on change.
   */
  const [steamCC, setSteamCC] = useState<string>(() => {
    return localStorage.getItem("steam_cc") || "us";
  });
  useEffect(() => {
    localStorage.setItem("steam_cc", steamCC.toLowerCase());
  }, [steamCC]);

  /** Feature flags: covers, IGDB, HLTB, OpenCritic.  Each flag lives in
   * localStorage as "0" or "1".  We provide simple toggles that update
   * localStorage when changed.
   */
  function useToggle(key: string, def = "0") {
    const [v, setV] = useState(() => localStorage.getItem(key) ?? def);
    useEffect(() => { localStorage.setItem(key, v); }, [key, v]);
    return [v === "1", (b: boolean) => setV(b ? "1" : "0")] as const;
  }
  const [coversOn, setCoversOn] = useToggle("covers_enabled", "1");
  const [igdbOn, setIgdbOn] = useToggle("igdb_enabled", "0");
  const [hltbOn, setHltbOn] = useToggle(
    "hltb_enabled",
    // Enable by default on desktop (Tauri).  Check for __TAURI__ presence.
    (() => {
      try {
        return (typeof window !== "undefined" && (window as any).__TAURI__) ? "1" : "0";
      } catch {
        return "0";
      }
    })()
  );
  const [ocOn, setOcOn] = useToggle("oc_enabled", "0");

  /**
   * Bulk fetch: iterate all library entries and update missing HLTB times.  Uses
   * the desktop bridge to fetch data.  Only available when running under
   * Tauri; otherwise shows an alert.  This function respects user
   * preferences, but does not prompt per item; it will attempt to fetch all
   * titles regardless of existing values.
   */
  async function fetchAllHLTB() {
    if (!isTauri) {
      alert("Fetching HLTB times is only supported on the desktop build.");
      return;
    }
    const libs = await db.library.toArray();
    for (const row of libs) {
      try {
        const identity = await db.identities.get(row.identityId);
        if (!identity || !identity.title) continue;
        const { mainMedianHours, source } = await fetchHLTB(identity.title);
        if (mainMedianHours != null) {
          await db.library.update(row.id, {
            ttbMedianMainH: mainMedianHours,
            ttbSource: source === "hltb-cache" ? "hltb-cache" : "hltb",
          } as any);
        }
      } catch (e: any) {
        console.error("HLTB bulk fetch failed for", row.id, e);
      }
    }
    alert("HLTB fetch complete.");
  }

  /**
   * Bulk fetch: iterate all library entries and update current Steam prices.
   * Uses the desktop bridge with the user's selected region and fallback
   * strategy.  Only runs under Tauri.  Stores both the price and currency
   * fields on each row.
   */
  async function fetchAllSteam() {
    if (!isTauri) {
      alert("Fetching Steam prices is only supported on the desktop build.");
      return;
    }
    const regionPref = steamCC.toLowerCase();
    const fallback = ["us", "gb", "eu", "de", "fr", "tr", "jp", "au"];
    const libs = await db.library.toArray();
    for (const row of libs) {
      const identity = await db.identities.get(row.identityId);
      if (!identity?.appid) continue;
      const appid = identity.appid;
      let result: { price: number; currency: string } | null = null;
      const regions = [regionPref, ...fallback.filter((c) => c !== regionPref)];
      for (const cc of regions) {
        try {
          result = await fetchSteamPrice(appid, cc);
        } catch (_e) {
          result = null;
        }
        if (result) break;
      }
      if (result) {
        await db.library.update(row.id, {
          priceTRY: result.price,
          priceCurrency: result.currency,
        } as any);
      }
    }
    alert("Steam price fetch complete.");
  }

  /**
   * Bulk fetch: iterate all entries and update OpenCritic scores.  Currently
   * disabled until a proper API is wired.  Shows an alert to the user.
   */
  async function fetchAllOpenCritic() {
    // Bulk fetch OpenCritic scores for all games.  Only runs on desktop
    // builds with the integration enabled.  Falls back to showing
    // informative messages when the feature is disabled or the app is
    // running in the browser.
    if (!isTauri) {
      alert("OpenCritic bulk fetch is only supported on the desktop build.");
      return;
    }
    if (!ocOn) {
      alert("Enable OpenCritic integration in settings to fetch scores.");
      return;
    }
    const libs = await db.library.toArray();
    for (const row of libs) {
      try {
        const identity = await db.identities.get(row.identityId);
        const title = identity?.title || "";
        if (!title) continue;
        const score = await fetchOpenCriticScore(title);
        if (score != null) {
          await db.library.update(row.id, { ocScore: score } as any);
        }
      } catch (e: any) {
        console.error("OpenCritic bulk fetch failed for", row.id, e);
      }
    }
    alert("OpenCritic fetch complete.");
  }

  /**
   * Clears the HLTB cache via Tauri.  Only available on desktop builds.
   */
  async function clearHLTBCache() {
    try {
      if (!(typeof window !== "undefined" && (window as any).__TAURI__)) {
        alert("HLTB cache clearing is desktop-only.");
        return;
      }
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
          <input type="checkbox" checked={coversOn} onChange={(e) => setCoversOn(e.target.checked)} />
          <span>Covers (Steam/IGDB URLs)</span>
        </label>
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={igdbOn} onChange={(e) => setIgdbOn(e.target.checked)} />
          <span>IGDB (TTB & cover id) — mocked until keys</span>
        </label>
        <label className="flex items-center gap-3" title={(() => {
          try {
            return (typeof window !== "undefined" && (window as any).__TAURI__) ? "" : "Desktop-only (Tauri)";
          } catch {
            return "Desktop-only (Tauri)";
          }
        })()}>
          <input type="checkbox" checked={hltbOn} disabled={!(typeof window !== "undefined" && (window as any).__TAURI__)} onChange={(e) => setHltbOn(e.target.checked)} />
          <span>HowLongToBeat (desktop)</span>
        </label>
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={ocOn} onChange={(e) => setOcOn(e.target.checked)} />
          <span>OpenCritic (requires API)</span>
        </label>
      </section>

      {/* Card layout fixed to "Large" size.  The card width is set globally to 340px via CSS. */}
      {/* Steam region selection */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Price region</h2>
        <div className="flex items-center gap-2">
          <span className="w-40">Steam region:</span>
          <select
            className="select"
            value={steamCC}
            onChange={(e) => setSteamCC(e.target.value)}
          >
            {[
              { cc: "tr", label: "Turkey" },
              { cc: "us", label: "USA" },
              { cc: "gb", label: "UK" },
              { cc: "eu", label: "EU" },
              { cc: "de", label: "Germany" },
              { cc: "fr", label: "France" },
              { cc: "ru", label: "Russia" },
              { cc: "ar", label: "Argentina" },
              { cc: "jp", label: "Japan" },
              { cc: "au", label: "Australia" },
            ].map(({ cc, label }) => (
              <option key={cc} value={cc}>
                {label} ({cc.toUpperCase()})
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Data</h2>
        <div className="flex flex-wrap gap-2">
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
          <button
            className="btn-ghost"
            onClick={clearHLTBCache}
            disabled={!(typeof window !== "undefined" && (window as any).__TAURI__)}
          >
            Clear HLTB Cache (desktop)
          </button>
        </div>
      </section>

      {/* Bulk fetch actions.  These buttons iterate through the entire
          library and update metadata in bulk.  They remain disabled when
          their respective integration is turned off or unavailable. */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Bulk fetch</h2>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn"
            onClick={fetchAllHLTB}
            disabled={!hltbOn}
            title={!hltbOn ? "Enable HowLongToBeat integration to use this" : "Fetch HLTB times for all games"}
          >
            Fetch all HLTB
          </button>
          <button
            className="btn"
            onClick={fetchAllSteam}
            disabled={!isTauri}
            title={isTauri ? "Fetch Steam prices for all games" : "Desktop-only"}
          >
            Fetch all Steam prices
          </button>
          <button
            className="btn"
            onClick={fetchAllOpenCritic}
            disabled={!ocOn}
            title={!ocOn ? "Enable OpenCritic integration to use this" : "Fetch OpenCritic scores for all games"}
          >
            Fetch all OpenCritic
          </button>
        </div>
      </section>
    </div>
  );
}