let isTauri = false;
try {
  isTauri = typeof (window as any).__TAURI__ !== "undefined";
} catch {}

export { isTauri }; // optional helper

export async function fetchSteamOwnedGames(steamId64: string, apiKey?: string) {
  if (isTauri) {
    if (!apiKey) throw new Error("API key required in desktop import.");
    const { fetchSteamOwnedGamesNative } = await import("./steam.desktop");
    return fetchSteamOwnedGamesNative(steamId64, apiKey);
  }
  throw new Error("Steam Web API import is not available in the web build.");
}

export async function fetchSteamPriceTRY(appid: number, cc = "tr") {
  if (isTauri) {
    const { fetchSteamPriceTRNative } = await import("./steam.desktop");
    return fetchSteamPriceTRNative(appid, cc); // returns number | null
  }
  throw new Error("Price fetch is desktop-only in this MVP.");
}


