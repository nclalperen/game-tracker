import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./bridge";

export type SteamProfile = {
  steamId: string;
  personaName: string;
  avatarFull?: string | null;
  profileUrl?: string | null;
  countryCode?: string | null;
  nowPlayingGameId?: string | null;
  nowPlayingGameName?: string | null;
  personaState?: number | null;
  visibilityState?: number | null;
  profileState?: number | null;
  lastLogoff?: number | null;
  primaryClanId?: string | null;
  timeCreated?: number | null;
  lastFetchedISO: string;
};

export type SteamOwnedGame = {
  appId: number;
  name: string;
  playtimeForeverMin: number;
  playtimeTwoWeeksMin?: number | null;
  lastPlayedAt?: number | null;
  hasVisibleStats: boolean;
  iconHash?: string | null;
  logoHash?: string | null;
  playtimeWindowsMin?: number | null;
  playtimeMacMin?: number | null;
  playtimeLinuxMin?: number | null;
  contentDescriptorIds?: number[] | null;
};

export type SteamRecentlyPlayed = {
  appId: number;
  name: string;
  playtimeTwoWeeksMin?: number | null;
  playtimeForeverMin?: number | null;
  lastPlayedAt?: number | null;
  iconHash?: string | null;
  logoHash?: string | null;
};

export type SteamPrice = {
  appId: number;
  currency: string;
  initial: number;
  final: number;
  discountPercent: number;
  lastFetchedISO: string;
};

export type SteamAppDetails = {
  appId: number;
  name: string;
  isFree: boolean;
  headerImage?: string | null;
  capsuleImage?: string | null;
  background?: string | null;
  shortDescription?: string | null;
  genres: string[];
  categories: string[];
  releaseDate?: string | null;
  controllerSupport?: string | null;
  pcRequirements?: {
    minimum?: string | null;
    recommended?: string | null;
  } | null;
  lastFetchedISO: string;
};

export type SteamNewsItem = {
  gid: string;
  title: string;
  url: string;
  author?: string | null;
  contents?: string | null;
  feedLabel?: string | null;
  date: number;
};

export type SteamAchievementItem = {
  apiName: string;
  achieved: boolean;
  unlockTime?: number | null;
};

export type SteamPlayerAchievements = {
  steamId: string;
  appId: number;
  unlocked: number;
  total: number;
  items: SteamAchievementItem[];
  lastFetchedISO: string;
};

export type SteamSchemaAchievement = {
  apiName: string;
  displayName: string;
  description?: string | null;
  icon?: string | null;
  iconGray?: string | null;
};

export type SteamAchievementSchema = {
  appId: number;
  items: SteamSchemaAchievement[];
  lastFetchedISO: string;
};

export type SteamAppIdName = {
  appId: number;
  name: string;
};

export type SteamInstallInfo = {
  appId: number;
  name?: string | null;
  installDir?: string | null;
  installPath?: string | null;
  sizeOnDisk?: number | null;
  lastUpdated?: number | null;
  manifestPath?: string | null;
};

function ensureTauri(action: string) {
  if (!isTauri) {
    throw new Error(`Desktop-only: run the Tauri app to ${action}.`);
  }
}

function mapProfile(raw: any): SteamProfile {
  return {
    steamId: raw?.steamid ?? "",
    personaName: raw?.personaname ?? "",
    avatarFull: raw?.avatarfull ?? null,
    profileUrl: raw?.profileurl ?? null,
    countryCode: raw?.loccountrycode ?? null,
    nowPlayingGameId: raw?.gameid ?? null,
    nowPlayingGameName: raw?.gameextrainfo ?? null,
    personaState: raw?.personastate ?? null,
    visibilityState: raw?.communityvisibilitystate ?? null,
    profileState: raw?.profilestate ?? null,
    lastLogoff: raw?.lastlogoff ?? null,
    primaryClanId: raw?.primaryclanid ?? null,
    timeCreated: raw?.timecreated ?? null,
    lastFetchedISO: raw?.last_fetched_iso ?? new Date().toISOString(),
  };
}

function mapOwnedGame(raw: any): SteamOwnedGame {
  return {
    appId: raw?.appid ?? 0,
    name: raw?.name ?? "Unknown App",
    playtimeForeverMin: raw?.playtime_forever_min ?? 0,
    playtimeTwoWeeksMin: raw?.playtime_2weeks_min ?? null,
    lastPlayedAt: raw?.rtime_last_played ?? null,
    hasVisibleStats: Boolean(raw?.has_visible_stats),
    iconHash: raw?.img_icon_url ?? null,
    logoHash: raw?.img_logo_url ?? null,
    playtimeWindowsMin: raw?.playtime_windows_forever_min ?? null,
    playtimeMacMin: raw?.playtime_mac_forever_min ?? null,
    playtimeLinuxMin: raw?.playtime_linux_forever_min ?? null,
    contentDescriptorIds: Array.isArray(raw?.content_descriptorids) ? raw.content_descriptorids : null,
  };
}

function mapRecentlyPlayed(raw: any): SteamRecentlyPlayed {
  return {
    appId: raw?.appid ?? 0,
    name: raw?.name ?? "Unknown App",
    playtimeTwoWeeksMin: raw?.playtime_2weeks_min ?? null,
    playtimeForeverMin: raw?.playtime_forever_min ?? null,
    lastPlayedAt: raw?.last_played ?? null,
    iconHash: raw?.img_icon_url ?? null,
    logoHash: raw?.img_logo_url ?? null,
  };
}

function mapAppDetails(raw: any): SteamAppDetails {
  return {
    appId: raw?.appid ?? 0,
    name: raw?.name ?? "Unknown App",
    isFree: Boolean(raw?.is_free),
    headerImage: raw?.header_image ?? null,
    capsuleImage: raw?.capsule_image ?? null,
    background: raw?.background ?? null,
    shortDescription: raw?.short_description ?? null,
    genres: Array.isArray(raw?.genres) ? raw.genres.filter(Boolean) : [],
    categories: Array.isArray(raw?.categories) ? raw.categories.filter(Boolean) : [],
    releaseDate: raw?.release_date ?? null,
    controllerSupport: raw?.controller_support ?? null,
    pcRequirements: raw?.pc_requirements ?? null,
    lastFetchedISO: raw?.last_fetched_iso ?? new Date().toISOString(),
  };
}

function mapPrice(raw: any): SteamPrice {
  return {
    appId: raw?.appid ?? 0,
    currency: raw?.currency ?? "USD",
    initial: raw?.initial ?? 0,
    final: raw?.final_ ?? raw?.final ?? 0,
    discountPercent: raw?.discount_percent ?? 0,
    lastFetchedISO: raw?.last_fetched_iso ?? new Date().toISOString(),
  };
}

function mapNews(raw: any): SteamNewsItem {
  return {
    gid: raw?.gid ?? "",
    title: raw?.title ?? "",
    url: raw?.url ?? "",
    author: raw?.author ?? null,
    contents: raw?.contents ?? null,
    feedLabel: raw?.feedlabel ?? null,
    date: raw?.date ?? 0,
  };
}

function mapPlayerAchievements(raw: any): SteamPlayerAchievements {
  return {
    steamId: raw?.steamid ?? "",
    appId: raw?.appid ?? 0,
    unlocked: raw?.unlocked ?? 0,
    total: raw?.total ?? 0,
    items: Array.isArray(raw?.items)
      ? raw.items.map((item: any) => ({
          apiName: item?.api_name ?? "",
          achieved: Boolean(item?.achieved),
          unlockTime: item?.unlock_time ?? null,
        }))
      : [],
    lastFetchedISO: raw?.last_fetched_iso ?? new Date().toISOString(),
  };
}

function mapSchema(raw: any): SteamAchievementSchema {
  return {
    appId: raw?.appid ?? 0,
    items: Array.isArray(raw?.items)
      ? raw.items.map((item: any) => ({
          apiName: item?.api_name ?? "",
          displayName: item?.display_name ?? "",
          description: item?.description ?? null,
          icon: item?.icon ?? null,
          iconGray: item?.icongray ?? null,
        }))
      : [],
    lastFetchedISO: raw?.last_fetched_iso ?? new Date().toISOString(),
  };
}

function mapInstall(raw: any): SteamInstallInfo {
  return {
    appId: raw?.appid ?? 0,
    name: raw?.name ?? null,
    installDir: raw?.installdir ?? null,
    installPath: raw?.install_path ?? null,
    sizeOnDisk: raw?.size_on_disk ?? null,
    lastUpdated: raw?.last_updated ?? null,
    manifestPath: raw?.manifest_path ?? null,
  };
}

export function normalizeSteamIdInput(input: string): string {
  let value = input.trim();
  if (!value) return value;

  const lower = value.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    try {
      const url = new URL(value);
      value = url.pathname;
    } catch {
      value = value.replace(/^https?:\/\/+/i, "");
      value = value.replace(/^steamcommunity\.com/i, "");
    }
  }

  value = value.replace(/^steamcommunity\.com/i, "");
  value = value.replace(/^\/+/g, "");
  value = value.replace(/^id\//i, "");
  value = value.replace(/^profiles\//i, "");
  const question = value.indexOf("?");
  if (question >= 0) {
    value = value.slice(0, question);
  }
  value = value.replace(/\/+$/g, "");
  return value.trim();
}

export async function resolveVanity(vanity: string): Promise<string> {
  ensureTauri("resolve Steam vanity URLs");
  const normalized = normalizeSteamIdInput(vanity);
  if (!normalized) {
    throw new Error("Enter a vanity handle or SteamID64.");
  }
  if (/^\d{17}$/.test(normalized)) {
    return normalized;
  }
  return invoke<string>("steam_resolve_vanity", { vanity: normalized });
}

export async function ensureSteamId(raw: string): Promise<{ id: string; resolved: boolean }> {
  const candidate = normalizeSteamIdInput(raw);
  if (!candidate) {
    throw new Error("Enter a Steam ID first.");
  }
  if (/^\d{17}$/.test(candidate)) {
    return { id: candidate, resolved: false };
  }
  if (!isTauri) {
    throw new Error("Resolving vanity URLs requires the desktop app.");
  }
  const resolved = await resolveVanity(candidate);
  return { id: resolved, resolved: true };
}

export async function getSteamProfile(steamId: string): Promise<SteamProfile> {
  ensureTauri("fetch Steam profile");
  const raw = await invoke<any>("steam_get_profile", { steamid: steamId });
  return mapProfile(raw);
}

export async function getOwnedGames(steamId: string, includeFree = true): Promise<SteamOwnedGame[]> {
  ensureTauri("fetch Steam owned games");
  const raw = await invoke<any[]>("steam_get_owned_games", { steamid: steamId, includeFree });
  return Array.isArray(raw) ? raw.map(mapOwnedGame) : [];
}

export async function getRecentlyPlayed(steamId: string): Promise<SteamRecentlyPlayed[]> {
  ensureTauri("fetch recently played games");
  const raw = await invoke<any[]>("steam_get_recently_played", { steamid: steamId });
  return Array.isArray(raw) ? raw.map(mapRecentlyPlayed) : [];
}

export async function getAppDetails(appId: number): Promise<SteamAppDetails> {
  ensureTauri("fetch Steam app details");
  const raw = await invoke<any>("steam_get_app_details", { appid: appId });
  return mapAppDetails(raw);
}

export async function getPrice(appId: number): Promise<SteamPrice | null> {
  ensureTauri("fetch Steam price");
  const raw = await invoke<any | null>("steam_get_price", { appid: appId });
  if (!raw) return null;
  return mapPrice(raw);
}

export async function getNews(appId: number, count = 4): Promise<SteamNewsItem[]> {
  ensureTauri("fetch Steam news");
  const raw = await invoke<any[]>("steam_get_news", { appid: appId, count });
  return Array.isArray(raw) ? raw.map(mapNews) : [];
}

export async function getCurrentPlayers(appId: number): Promise<number | null> {
  ensureTauri("fetch Steam player counts");
  const raw = await invoke<number | null>("steam_get_current_players", { appid: appId });
  return typeof raw === "number" ? raw : null;
}

export async function getPlayerAchievements(
  steamId: string,
  appId: number,
): Promise<SteamPlayerAchievements | null> {
  ensureTauri("fetch Steam achievements");
  const raw = await invoke<any | null>("steam_get_player_achievements", { steamid: steamId, appid: appId });
  if (!raw) return null;
  return mapPlayerAchievements(raw);
}

export async function getSchemaForGame(appId: number): Promise<SteamAchievementSchema | null> {
  ensureTauri("fetch Steam achievement schema");
  const raw = await invoke<any | null>("steam_get_schema_for_game", { appid: appId });
  if (!raw) return null;
  return mapSchema(raw);
}

export async function getAppList(): Promise<SteamAppIdName[]> {
  ensureTauri("fetch Steam app list");
  const raw = await invoke<any[]>("steam_get_applist");
  return Array.isArray(raw)
    ? raw.map((item) => ({
        appId: item?.appid ?? 0,
        name: item?.name ?? "Unknown App",
      }))
    : [];
}

export async function scanSteamManifests(): Promise<SteamInstallInfo[]> {
  ensureTauri("scan Steam manifests");
  const raw = await invoke<any[]>("steam_scan_manifests");
  return Array.isArray(raw) ? raw.map(mapInstall) : [];
}
