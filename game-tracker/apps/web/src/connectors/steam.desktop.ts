import { invoke } from "@tauri-apps/api/core";

export async function fetchSteamOwnedGamesNative(steamId64: string, apiKey: string) {
  return await invoke<any[]>("get_owned_games", { steamApiKey: apiKey, steamid64: steamId64 });
}

export async function fetchSteamPriceTRNative(appid: number, cc = "tr") {
  const json: any = await invoke("get_steam_price_try", { appid, cc });
  const data = json?.[appid]?.data;
  const final = data?.price_overview?.final;
  return typeof final === "number" ? final / 100 : null;
}
