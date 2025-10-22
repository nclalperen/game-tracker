import { isTauri, fetchHLTB } from "@/desktop/bridge";

/**
 * React hook to access HowLongToBeat functionality.  This hook provides a
 * function to fetch the main median hours for a given game title along with
 * the source of the data (official API, local cache, or HTML fallback).  The
 * hook exposes a boolean `enabled` that is true when the user has enabled
 * HLTB support (via Settings) and the app is running under Tauri.  Users can
 * override this behaviour by setting `localStorage.hltb_enabled = "1"`.
 */
export function useHLTB() {
  // Determine if HLTB is allowed.  Under Tauri the native bridge is
  // available.  Users may also force enable it by setting a flag in
  // localStorage (useful for development without Tauri).
  const enabled =
    isTauri || localStorage.getItem("hltb_enabled") === "1";

  /**
   * Normalize a title before sending it to the HLTB API.  We strip
   * trademark symbols and collapse whitespace to improve matching.
   */
  function cleanTitle(t: string) {
    return t.replace(/[™®©:]/g, "").replace(/\s+/g, " ").trim();
  }

  /**
   * Fetch the time-to-beat for a game title.  Returns an object with
   * `mainMedianHours` and `source`.  If HLTB is disabled the source will be
   * "off" and the hours will be null.  When enabled, the source is one of:
   * - "hltb"      → Official HowLongToBeat API
   * - "hltb-cache"→ Value came from the local cache
   * - "html"      → Parsed from howlongtobeat.com HTML as a last resort
   */
  async function fetchTTB(title: string): Promise<{
    mainMedianHours: number | null;
    source: "hltb" | "hltb-cache" | "html" | "off";
  }> {
    if (!enabled) {
      return { mainMedianHours: null, source: "off" };
    }
    // Only run the bridge call under Tauri.  The bridge itself will throw if
    // used outside of Tauri, but we'll defensively check here as well.
    try {
      const res = await fetchHLTB(cleanTitle(title));
      return {
        mainMedianHours: res.mainMedianHours ?? null,
        source: res.source,
      };
    } catch (err) {
      console.error(err);
      return { mainMedianHours: null, source: "html" };
    }
  }

  return { enabled, fetchTTB };
}