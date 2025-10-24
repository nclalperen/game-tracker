import { invoke } from "@tauri-apps/api/core";

export const isTauri =
  typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);

export type HLTBResult = {
  mainMedianHours: number | null;
  source: "hltb" | "hltb-cache" | "html";
};

export type SteamPriceResult = { price: number; currency: string } | null;

export async function fetchHLTB(title: string): Promise<HLTBResult> {
  if (!isTauri) throw new Error("Desktop-only: run Tauri to use HLTB.");
  const res = await invoke<{ main_median_hours?: number | null; source?: string }>("hltb_search", { title });
  const hours = res?.main_median_hours ?? null;
  const source = (() => {
    if (res?.source === "hltb-cache") return "hltb-cache" as const;
    if (res?.source === "html") return "html" as const;
    return "hltb" as const;
  })();
  return { mainMedianHours: hours, source };
}

export async function fetchSteamPrice(appid: number, region?: string): Promise<SteamPriceResult> {
  if (!isTauri) throw new Error("Desktop-only: run Tauri to fetch Steam price.");
  const res = await invoke<{ price?: number | null; currency?: string | null }>("get_steam_price_try", {
    appid,
    region,
  });
  if (res == null || res.price == null || !res.currency) {
    return null;
  }
  return { price: res.price, currency: res.currency.toUpperCase() };
}

export async function fetchOpenCriticScore(title: string): Promise<number | null> {
  if (!isTauri) throw new Error("Desktop-only: run Tauri to fetch OpenCritic scores.");
  const res = await invoke<number | null>("get_opencritic_score", { title });
  return res ?? null;
}
