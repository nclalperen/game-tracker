import { useState, useEffect } from "react";
import { clearAllData, clearRawgCache, db, getSetting, replaceSteamRecentRows, setSetting } from "@/db";
import { lookupLocalHLTB } from "@/data/localDatasets";
import { fetchSteamPrice, fetchOpenCriticScore, isTauri } from "@/desktop/bridge";
import {
  ensureSteamId,
  getSteamProfile,
  getOwnedGames,
} from "@/desktop/steamBridge";
import { useEnrichmentRunner } from "@/state/enrichmentRunner";
import { useVendorFlag, setVendorFlag, type VendorKey } from "@/state/vendorFlags";
import { resetMCIndexCache } from "@/data/metacriticIndex";
import { clearRawgApiCache } from "@/apis/rawg";
import { invoke } from "@tauri-apps/api/core";

const STEAM_REGION_OPTIONS = [
  { value: "us", label: "United States" },
  { value: "gb", label: "United Kingdom" },
  { value: "eu", label: "Eurozone" },
  { value: "de", label: "Germany" },
  { value: "fr", label: "France" },
  { value: "tr", label: "Turkey" },
  { value: "jp", label: "Japan" },
  { value: "au", label: "Australia" },
  { value: "br", label: "Brazil" },
];

const STEAM_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "pt", label: "Portuguese" },
  { value: "ru", label: "Russian" },
  { value: "tr", label: "Turkish" },
  { value: "ja", label: "Japanese" },
  { value: "zh-cn", label: "Chinese (Simplified)" },
];

/**
 * Settings page for Game Tracker.  This component allows users to toggle
 * integrations, adjust card layout, and choose the Steam region for price
 * fetching.  All preferences are persisted in localStorage and applied on
 * first mount.  Hooks are used exclusively inside the component body to
 * satisfy React's rules of hooks.
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
  const [steamSettingsLoaded, setSteamSettingsLoaded] = useState(false);
  const [steamInput, setSteamInput] = useState("");
  const [savedSteamId, setSavedSteamId] = useState<string | null>(null);
  const [steamRegion, setSteamRegion] = useState("us");
  const [steamLanguage, setSteamLanguage] = useState("en");
  const [steamResolveState, setSteamResolveState] = useState<{ status: "idle" | "pending" | "success" | "error"; message?: string }>(() => ({ status: "idle" }));
  const [steamTestState, setSteamTestState] = useState<{ status: "idle" | "pending" | "success" | "error"; message?: string }>(() => ({ status: "idle" }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [storedId, storedRegion, storedLang] = await Promise.all([
          getSetting<string>("steam.myId"),
          getSetting<string>("steam.region"),
          getSetting<string>("steam.lang"),
        ]);
        if (cancelled) return;
        if (storedId) {
          setSteamInput(storedId);
          setSavedSteamId(storedId);
        }
        const regionPref = (storedRegion || localStorage.getItem("steam_cc") || "us").toLowerCase();
        setSteamRegion(regionPref);
        localStorage.setItem("steam_cc", regionPref);
        const langPref = (storedLang || localStorage.getItem("steam_lang") || "en").toLowerCase();
        setSteamLanguage(langPref);
        localStorage.setItem("steam_lang", langPref);
      } finally {
        if (!cancelled) {
          setSteamSettingsLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!steamSettingsLoaded) return;
    const value = steamRegion.toLowerCase();
    void setSetting("steam.region", value);
    localStorage.setItem("steam_cc", value);
  }, [steamRegion, steamSettingsLoaded]);

  useEffect(() => {
    if (!steamSettingsLoaded) return;
    const value = steamLanguage.toLowerCase();
    void setSetting("steam.lang", value);
    localStorage.setItem("steam_lang", value);
  }, [steamLanguage, steamSettingsLoaded]);

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
  const [ocOn, setOcOn] = useToggle("oc_enabled", "0");
  const [changingVendor, setChangingVendor] = useState<VendorKey | null>(null);
  const hltbEnabled = useVendorFlag("hltb");
  const rawgEnabled = useVendorFlag("rawg");
  const metacriticEnabled = useVendorFlag("metacritic");

  const hltbPending = changingVendor === "hltb";
  const rawgPending = changingVendor === "rawg";
  const metacriticPending = changingVendor === "metacritic";

  const toggleVendor = async (key: VendorKey, value: boolean) => {
    setChangingVendor(key);
    try {
      await setVendorFlag(key, value);
    } finally {
      setChangingVendor((current) => (current === key ? null : current));
    }
  };

  const {
    snapshot: enrichmentSnapshot,
    resume: resumeEnrichment,
    halt: haltEnrichment,
  } = useEnrichmentRunner();
  const hasEnrichmentSession = Boolean(enrichmentSnapshot.sessionId);
  const enrichmentStatus = hasEnrichmentSession
    ? enrichmentSnapshot.halted
      ? "Halted"
      : enrichmentSnapshot.paused
      ? "Paused"
      : "Running"
    : "Idle";
  const enrichmentProgress =
    hasEnrichmentSession && enrichmentSnapshot.totalRows
      ? `${enrichmentSnapshot.completedCount} / ${enrichmentSnapshot.totalRows}`
      : hasEnrichmentSession
      ? `${enrichmentSnapshot.completedCount} items processed`
      : "";
  const canResumeEnrichment = hasEnrichmentSession && enrichmentSnapshot.paused;
  const canHaltEnrichment = hasEnrichmentSession && !enrichmentSnapshot.halted;
  const handleResumeEnrichment = () => {
    resumeEnrichment();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gt:show-enrichment"));
    }
  };
  const handleHaltEnrichment = () => {
    haltEnrichment();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gt:hide-enrichment"));
    }
  };

  const formatSteamError = (err: unknown, fallback: string) => {
    const raw =
      typeof err === "string" ? err : (err as { message?: string })?.message ?? fallback;
    if (typeof raw !== "string") return fallback;
    if (raw.toLowerCase().includes("player not found")) {
      return "Steam could not find that profile. Double-check the vanity URL or ensure your profile is public.";
    }
    if (raw.toLowerCase().includes("missing") && raw.toLowerCase().includes("api key")) {
      return "Steam API key is not configured. Add STEAM_WEB_API_KEY to your desktop environment.";
    }
    return raw;
  };

  const handleResolveSteam = async () => {
    try {
      setSteamResolveState({ status: "pending" });
      const { id, resolved } = await ensureSteamId(steamInput);
      setSteamInput(id);
      setSteamResolveState({
        status: "success",
        message: resolved ? `Resolved to ${id}` : "Looks like a SteamID64 already.",
      });
    } catch (err) {
      setSteamResolveState({
        status: "error",
        message: formatSteamError(err, "Failed to resolve vanity URL."),
      });
    }
  };

  const handleSaveSteamId = async () => {
    try {
      setSteamResolveState({ status: "pending" });
      const { id, resolved } = await ensureSteamId(steamInput);
      await setSetting("steam.myId", id);
      setSavedSteamId(id);
      setSteamInput(id);
      setSteamResolveState({
        status: "success",
        message: resolved ? `Resolved vanity and saved SteamID64 ${id}.` : "Steam ID saved.",
      });
      setSteamTestState({ status: "idle" });
    } catch (err) {
      setSteamResolveState({
        status: "error",
        message: formatSteamError(err, "Could not save Steam ID."),
      });
    }
  };

  const handleTestSteam = async () => {
    if (!isTauri) {
      setSteamTestState({ status: "error", message: "Testing requires the desktop app." });
      return;
    }
    const source = savedSteamId ?? steamInput;
    if (!source.trim()) {
      setSteamTestState({ status: "error", message: "Save your Steam ID before testing." });
      return;
    }
    try {
      setSteamTestState({ status: "pending" });
      const { id, resolved } = await ensureSteamId(source);
      if (resolved || (!savedSteamId && id !== source)) {
        await setSetting("steam.myId", id);
        setSavedSteamId(id);
        setSteamInput(id);
      }
      const profile = await getSteamProfile(id);
      const owned = await getOwnedGames(id, true);
      const total = owned.length;
      const note =
        total > 0 ? `Detected ${total} owned ${total === 1 ? "game" : "games"}.` : "No owned games detected.";
      setSteamTestState({
        status: "success",
        message: `Hello ${profile.personaName || id}. ${note}`,
      });
    } catch (err) {
      setSteamTestState({
        status: "error",
        message: formatSteamError(err, "Steam API test failed."),
      });
    }
  };

  /**
   * Bulk fetch: iterate all library entries and update missing HLTB times using
   * the local dataset. Titles not present in the dataset are skipped.
   */
  async function fetchAllHLTB() {
    if (!hltbEnabled) {
      alert("Enable HowLongToBeat in Settings before running the bulk update.");
      return;
    }
    const libs = await db.library.toArray();
    let updated = 0;
    for (const row of libs) {
      try {
        const identity = await db.identities.get(row.identityId);
        if (!identity || !identity.title) continue;
        const hours = await lookupLocalHLTB(identity.title, identity.platform ?? undefined);
        if (hours == null) continue;
        await db.library.update(row.id, {
          ttbMedianMainH: hours,
        } as any);
        await db.identities.update(row.identityId, {
          ttbSource: "hltb-local",
          ttbMedianMainH: hours,
        } as any);
        updated++;
      } catch (e) {
        console.error("HLTB local fetch failed for", row?.identityId, e);
      }
    }
    alert(`HLTB local update complete (${updated} updated).`);
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
    const regionPref = steamRegion.toLowerCase();
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
          currencyCode: result.currency,
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
      await invoke("hltb_clear_cache");
      alert("HLTB cache cleared.");
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

  async function clearRawgCaches() {
    try {
      const { games, explore } = await clearRawgCache();
      clearRawgApiCache();
      alert(
        `RAWG cache cleared (${games} detail entr${games === 1 ? "y" : "ies"}, ${explore} explore entr${explore === 1 ? "y" : "ies"}).`,
      );
    } catch (e: any) {
      alert(e?.message || "Failed to clear RAWG cache.");
    }
  }

  function clearMetacriticCache() {
    resetMCIndexCache();
    alert("Metacritic vendor cache cleared. The next lookup will reload the index.");
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Integrations</h2>
        <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Display</h3>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={coversOn} onChange={(e) => setCoversOn(e.target.checked)} />
            <span>Covers (Steam / IGDB URLs)</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={igdbOn} onChange={(e) => setIgdbOn(e.target.checked)} />
            <span>IGDB mock covers</span>
          </label>
        </div>
        <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Vendor data sources</h3>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={hltbEnabled}
              disabled={hltbPending}
              onChange={(event) => toggleVendor("hltb", event.target.checked)}
            />
            <span>HowLongToBeat (local dataset + desktop live)</span>
          </label>
          <p className="pl-7 text-xs text-zinc-500">
            Desktop live lookups still require the Tauri app; when disabled, enrichment skips all HLTB sources.
          </p>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={rawgEnabled}
              disabled={rawgPending}
              onChange={(event) => toggleVendor("rawg", event.target.checked)}
            />
            <span>RAWG metadata (covers, media, fallback scores)</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={metacriticEnabled}
              disabled={metacriticPending}
              onChange={(event) => toggleVendor("metacritic", event.target.checked)}
            />
            <span>Metacritic vendor index</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={ocOn} onChange={(e) => setOcOn(e.target.checked)} />
            <span>OpenCritic (desktop live, requires API key)</span>
          </label>
        </div>
        <p className="text-xs text-zinc-500">
          When all vendors are enabled the enrichment pipeline tries Steam → HLTB → RAWG for playtime and
          Metacritic → OpenCritic for critic scores.
        </p>
      </section>

      {/* Card layout fixed to "Large" size.  The card width is set globally to 340px via CSS. */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Steam</h2>
        <p className="text-sm text-zinc-600">
          Connect your Steam account to import owned games, prices, news, and achievements.
        </p>
        <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Vanity URL or SteamID64</span>
            <input
              type="text"
              value={steamInput}
              onChange={(event) => {
                setSteamInput(event.target.value);
                setSteamResolveState({ status: "idle" });
              }}
              placeholder="https://steamcommunity.com/id/yourname"
              className="input"
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              onClick={handleResolveSteam}
              disabled={!isTauri || steamResolveState.status === "pending"}
            >
              {steamResolveState.status === "pending" ? "Resolving..." : "Resolve vanity"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={handleSaveSteamId}
              disabled={!steamInput.trim()}
            >
              Save as my Steam ID
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={handleTestSteam}
              disabled={!isTauri || steamTestState.status === "pending"}
            >
              {steamTestState.status === "pending" ? "Testing..." : "Test connection"}
            </button>
          </div>
          {savedSteamId ? (
            <p className="text-xs text-zinc-500">
              Saved ID: <span className="font-mono text-zinc-700">{savedSteamId}</span>
            </p>
          ) : null}
          {steamResolveState.status !== "idle" && steamResolveState.message ? (
            <p
              className={`text-xs ${
                steamResolveState.status === "error" ? "text-rose-600" : "text-emerald-600"
              }`}
            >
              {steamResolveState.message}
            </p>
          ) : null}
          {steamTestState.status !== "idle" && steamTestState.message ? (
            <p
              className={`text-xs ${
                steamTestState.status === "error" ? "text-rose-600" : "text-emerald-600"
              }`}
            >
              {steamTestState.message}
            </p>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Store region</span>
            <select
              className="select"
              value={steamRegion}
              onChange={(event) => setSteamRegion(event.target.value)}
            >
              {STEAM_REGION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.value.toUpperCase()})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Store language</span>
            <select
              className="select"
              value={steamLanguage}
              onChange={(event) => setSteamLanguage(event.target.value)}
            >
              {STEAM_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Enrichment session</h2>
        {hasEnrichmentSession ? (
          <>
            <p className="text-sm text-zinc-600">
              Status: <span className="font-medium text-zinc-800">{enrichmentStatus}</span>
              {enrichmentProgress ? ` - ${enrichmentProgress}` : ""}
            </p>
            {enrichmentSnapshot.halted && (
              <p className="text-xs text-amber-600">
                Metadata from this run is flagged until the remaining rows finish. Resume when ready.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn"
                onClick={handleResumeEnrichment}
                disabled={!canResumeEnrichment}
                title={
                  canResumeEnrichment
                    ? "Resume enrichment"
                    : "Resume is available when the session is paused or halted"
                }
              >
                Resume enrichment
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={handleHaltEnrichment}
                disabled={!canHaltEnrichment}
                title="Halt enrichment and continue later"
              >
                Halt
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("gt:show-enrichment"));
                  }
                }}
              >
                Show progress
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-600">
            No background enrichment session is pending. Start an import to enrich metadata.
          </p>
        )}
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
          <button
            className="btn-ghost"
            onClick={clearRawgCaches}
            title="Removes cached RAWG detail and explore entries."
          >
            Clear RAWG Cache
          </button>
          <button
            className="btn-ghost"
            onClick={clearMetacriticCache}
            title="Resets the in-memory Metacritic vendor index."
          >
            Reset Metacritic Cache
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
            disabled={!hltbEnabled || hltbPending}
            title={
              !hltbEnabled
                ? "Enable HowLongToBeat integration to use this"
                : hltbPending
                  ? "Updating HowLongToBeat preference..."
                  : "Fetch HLTB times for all games"
            }
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
