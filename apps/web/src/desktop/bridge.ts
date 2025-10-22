// Desktop bridge usable from the web app, with safe no-TAURI fallbacks.

export const isTauri =
  typeof window !== "undefined" && "__TAURI__" in (window as any);

/**
 * Fetch HowLongToBeat data for a game title via Tauri.  Returns an object
 * containing the main median hours (if available) and the source of the data.
 * If running outside of Tauri, throws an error.  The source can be
 * "hltb" (official API), "cache" (from local cache), or "html" (scraped HTML).
 */
export async function fetchHLTB(
  title: string
): Promise<{ mainMedianHours: number | null; source: "hltb" | "hltb-cache" | "html" }> {
  if (!isTauri) throw new Error("Desktop-only: run Tauri to use HLTB.");
  const { invoke } = await import("@tauri-apps/api/core");
  const res = await invoke<{ main_median_hours?: number; source?: string }>("hltb_search", { title });
  const hours = res?.main_median_hours ?? null;
  let src: "hltb" | "hltb-cache" | "html" = "html";
  if (res?.source === "hltb") src = "hltb";
  else if (res?.source === "cache") src = "hltb-cache";
  return { mainMedianHours: hours, source: src };
}

/**
 * Fetch Steam price for an appid in a given region.  Returns an object with
 * the numeric price and the currency code.  If the price is unavailable,
 * returns null.  The region argument should be an ISO 3166 country code
 * (e.g. "us", "gb", "de", etc.).
 */
export async function fetchSteamPrice(
  appid: number,
  region: string
): Promise<{ price: number; currency: string } | null> {
  if (!isTauri) throw new Error("Desktop-only: run Tauri to fetch Steam price.");
  const { invoke } = await import("@tauri-apps/api/core");
  const res = await invoke<{ price?: number; currency?: string }>("get_steam_price_try", { appid, region });
  if (res == null || res.price == null || !res.currency) {
    return null;
  }
  return { price: res.price, currency: res.currency.toUpperCase() };
}

/**
 * Fetch the OpenCritic score for a given game title via the Tauri backend.
 * This function searches for the title and returns the top critic score
 * (0–100) as a floating point number.  If no score is available or the
 * game is not found, returns null.  Throws an error when called on the
 * web build.
 */
export async function fetchOpenCriticScore(title: string): Promise<number | null> {
  if (!isTauri) throw new Error("Desktop-only: run Tauri to fetch OpenCritic scores.");
  const { invoke } = await import("@tauri-apps/api/core");
  // The backend returns an Option<f32>.  Null is used to indicate absence.
  const res = await invoke<number | null>("get_opencritic_score", { title });
  return res ?? null;
}
