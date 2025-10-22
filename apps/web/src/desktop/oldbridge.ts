// Desktop bridge usable from the web app, with safe no-TAURI fallbacks.

export const isTauri =
  typeof window !== "undefined" && "__TAURI__" in (window as any);

/** HowLongToBeat: returns median main hours or null. Desktop-only. */
export async function fetchHLTB(title: string): Promise<number | null> {
  if (!isTauri) throw new Error("Desktop-only: run Tauri to use HLTB.");
  const { invoke } = await import("@tauri-apps/api/core");
  const res = await invoke<{ main_median_hours?: number }>("hltb_search", { title });
  return res?.main_median_hours ?? null;
}

/** Steam price (TRY) by appid. Desktop-only (Tauri). */
export async function fetchSteamPriceTRY(
  appid: number,
  region: "tr" | "us" | "eu" = "tr"
): Promise<number | null> {
  if (!isTauri) throw new Error("Desktop-only: run Tauri to fetch Steam price.");
  const { invoke } = await import("@tauri-apps/api/core");
  const res = await invoke<{ price_try?: number }>("get_steam_price_try", { appid, region });
  return res?.price_try ?? null;
}
