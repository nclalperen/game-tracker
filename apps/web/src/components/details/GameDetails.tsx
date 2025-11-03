import { useEffect, useMemo, useState, useCallback, useId } from "react";
import {
  normalizeTitle,
  pricePerHour,
  modalSessionMinutes,
  planSessions,
  type PlannerResult,
  type PlannerStep,
} from "@tracker/core";
import type { Identity, LibraryItem } from "@tracker/core";
import {
  db,
  getRawgGame,
  getRawgGameByTitleKey,
  upsertRawgGame,
  isRawgGameStale,
  isRawgMediaStale,
  getSetting,
  getSteamPriceRow,
  getSteamNewsRow,
  getSteamAchievementsRow,
  getSteamSchemaRow,
  getSteamOwnedRows,
  getSteamRecentRows,
  getSteamPlayerCountRow,
  recentSessions,
  getPlanForIdentity,
  savePlan,
  updatePlan,
  isSteamPriceStale,
  isSteamNewsStale,
  isSteamAchievementsStale,
  isSteamSchemaStale,
  isSteamOwnedStale,
  isSteamRecentStale,
  isSteamPlayerCountStale,
  upsertSteamPriceRow,
  upsertSteamNewsRow,
  upsertSteamAchievementsRow,
  upsertSteamSchemaRow,
  upsertSteamPlayerCountRow,
  type RawgGameCache,
  type RawgMovie,
  type RawgScreenshot,
  type RawgStoreInfo,
  type SteamNewsItem,
  type SteamAchievementItem,
  type SteamSchemaEntry,
  type SteamAchievementsRow,
  type SteamOwnedRow,
  type SteamRecentRow,
  type SteamPriceRow,
  type PlanRow,
  type PlanStep,
} from "@/db";
import { searchByTitle, getGame, getScreenshots, getMovies } from "@/apis/rawg";
import { sanitizeHtml } from "@/utils/sanitizeHtml";
import { getStoreInfo } from "@/data/storeMap";
import GameCover from "@/components/GameCover";
import clsx from "clsx";
import { useVendorFlag, isVendorEnabled } from "@/state/vendorFlags";
import { isTauri } from "@/desktop/bridge";
import {
  getPrice as fetchSteamPriceDetail,
  getNews as fetchSteamNews,
  getPlayerAchievements,
  getSchemaForGame,
  getOwnedGames,
  getRecentlyPlayed,
  getCurrentPlayers,
} from "@/desktop/steamBridge";

type RequestTask<T> = () => Promise<T>;

type SteamPriceSummary = {
  amount: number;
  currency: string;
  discountPercent: number | null;
  lastFetchedISO: string;
  source: "steam";
};

type SteamPlaytimeSummary = {
  playtimeForeverMin: number | null;
  playtimeTwoWeeksMin: number | null;
  lastPlayedAtISO: string | null;
};

type SteamAchievementViewItem = {
  apiName: string;
  achieved: boolean;
  unlockTime?: number | null;
  displayName: string;
  description?: string | null;
  icon?: string | null;
  iconGray?: string | null;
};

type SteamAchievementsView = {
  unlocked: number;
  total: number;
  items: SteamAchievementViewItem[];
};

type GameDetailsData = {
  identity: Identity;
  libraryItems: LibraryItem[];
  rawg: RawgGameCache | null;
  sanitizedDescription: string;
  backgroundImage: string | null;
  coverUrl: string | null;
  coverAlt: string;
  criticBadge?: {
    value: number;
    source: "metacritic" | "opencritic" | "rawg";
    label: string;
    aria: string;
  };
  criticSources: Array<{ source: string; value: number | null }>;
  ttb: {
    value: number | null;
    sourceLabel: string | null;
    aria: string;
  };
  genres: string[];
  tags: string[];
  developers: string[];
  publishers: string[];
  releaseDate: string | null;
  esrb: string | null;
  stores: RawgStoreInfo[];
  screenshots: RawgScreenshot[];
  movies: RawgMovie[];
  ocScore: number | null;
  mcScore: number | null;
  rawgScore: number | null;
  steamPrice: SteamPriceSummary | null;
  steamNews: SteamNewsItem[];
  steamAchievements: SteamAchievementsView | null;
  steamOwned: SteamPlaytimeSummary | null;
  steamRecent: SteamPlaytimeSummary | null;
  steamCurrentPlayers: number | null;
  steamRefreshed: boolean;
};

type GameDetailsState =
  | { status: "loading" }
  | { status: "ready"; data: GameDetailsData }
  | { status: "error"; message: string };

type SteamExtras = {
  price: SteamPriceSummary | null;
  news: SteamNewsItem[];
  achievements: SteamAchievementsView | null;
  owned: SteamPlaytimeSummary | null;
  recent: SteamPlaytimeSummary | null;
  currentPlayers: number | null;
  refreshed: boolean;
};

const MEMORY_CACHE_MAX = 20;
const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000;
const PREFETCH_COOLDOWN_MS = 3000;

const inMemoryCache = new Map<string, { data: GameDetailsData; timestamp: number }>();
const pendingPrefetch = new Map<string, Promise<void>>();
let lastOpened: { id: string; time: number } | null = null;

let requestQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function scheduleRawg<T>(task: RequestTask<T>): Promise<T> {
  const run = async () => {
    const now = Date.now();
    const wait = Math.max(0, lastRequestAt + 1000 - now);
    if (wait > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, wait));
    }
    const result = await task();
    lastRequestAt = Date.now();
    return result;
  };

  const next = requestQueue.then(run, run);
  requestQueue = next.then(
    () => {},
    () => {},
  );
  return next;
}

function remember(id: string, data: GameDetailsData) {
  inMemoryCache.set(id, { data, timestamp: Date.now() });
  if (inMemoryCache.size > MEMORY_CACHE_MAX) {
    const [oldestKey] =
      [...inMemoryCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0] ?? [];
    if (oldestKey) inMemoryCache.delete(oldestKey);
  }
}

function fromMemory(id: string): GameDetailsData | undefined {
  const cached = inMemoryCache.get(id);
  if (!cached) return undefined;
  if (Date.now() - cached.timestamp > MEMORY_CACHE_TTL_MS) {
    inMemoryCache.delete(id);
    return undefined;
  }
  return cached.data;
}

async function loadLibraryItems(identityId: string): Promise<LibraryItem[]> {
  return db.library.where("identityId").equals(identityId).toArray();
}

function toSteamPriceSummary(row: SteamPriceRow | undefined): SteamPriceSummary | null {
  if (!row) return null;
  const amount = Number(row.final);
  if (!Number.isFinite(amount)) {
    return null;
  }
  const currency = (row.currency ?? "").toUpperCase();
  return {
    amount,
    currency,
    discountPercent: Number.isFinite(row.discountPercent) ? row.discountPercent : null,
    lastFetchedISO: row.lastFetchedISO,
    source: "steam",
  };
}

function toPlaytimeSummary(row: SteamOwnedRow | SteamRecentRow | undefined | null): SteamPlaytimeSummary | null {
  if (!row) return null;
  const foreverValue = Number(row.playtimeForeverMin);
  const twoWeeksValue = Number(row.playtimeTwoWeeksMin);
  const lastPlayed =
    row.lastPlayedAt != null && Number.isFinite(row.lastPlayedAt)
      ? new Date(row.lastPlayedAt * 1000).toISOString()
      : null;
  return {
    playtimeForeverMin: Number.isFinite(foreverValue) ? foreverValue : null,
    playtimeTwoWeeksMin: Number.isFinite(twoWeeksValue) ? twoWeeksValue : null,
    lastPlayedAtISO: lastPlayed,
  };
}

function toAchievementsView(
  row: SteamAchievementsRow | undefined,
  schemaEntries: SteamSchemaEntry[] | undefined,
): SteamAchievementsView | null {
  if (!row) return null;
  const lookup = new Map<string, SteamSchemaEntry>();
  if (Array.isArray(schemaEntries)) {
    for (const entry of schemaEntries) {
      if (!entry?.apiName) continue;
      lookup.set(entry.apiName.toLowerCase(), entry);
    }
  }
  const items: SteamAchievementViewItem[] = (row.items ?? []).map((item: SteamAchievementItem) => {
    const key = item.apiName?.toLowerCase?.() ?? "";
    const schema = lookup.get(key) ?? lookup.get(item.apiName ?? "");
    return {
      apiName: item.apiName,
      achieved: Boolean(item.achieved),
      unlockTime: item.unlockTime ?? null,
      displayName: schema?.displayName ?? item.apiName,
      description: schema?.description ?? null,
      icon: schema?.icon ?? null,
      iconGray: schema?.iconGray ?? null,
    };
  });
  return {
    unlocked: row.unlocked ?? 0,
    total: row.total ?? items.length,
    items,
  };
}

function computeCover(identity: Identity, rawg: RawgGameCache | null): { coverUrl: string | null; alt: string } {
  if (identity.appid) {
    return {
      coverUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${identity.appid}/library_600x900.jpg`,
      alt: `${identity.title} cover art`,
    };
  }
  if (rawg?.backgroundImage) {
    return { coverUrl: rawg.backgroundImage, alt: `${rawg.title} artwork` };
  }
  if (identity.igdbCoverId) {
    return {
      coverUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/${identity.igdbCoverId}.jpg`,
      alt: `${identity.title} cover art`,
    };
  }
  return { coverUrl: null, alt: `${identity.title} cover placeholder` };
}

async function resolveRawgDetail(identity: Identity): Promise<RawgGameCache | null> {
  const titleKey = normalizeTitle(identity.title ?? "");
  if (!titleKey) return null;

  const cachedByTitle = await getRawgGameByTitleKey(titleKey);
  if (!isVendorEnabled("rawg")) {
    return null;
  }
  if (cachedByTitle && !isRawgGameStale(cachedByTitle)) {
    if (!identity.rawgId && cachedByTitle?.id) {
      await db.identities.update(identity.id, {
        rawgId: cachedByTitle.id,
        rawgSlug: cachedByTitle.slug,
      } as Partial<Identity>);
    }
    return cachedByTitle;
  }

  if (identity.rawgId) {
    const cached = await getRawgGame(identity.rawgId);
    if (cached && !isRawgGameStale(cached)) {
      return cached;
    }
  }

  const attempts: Array<{ precise?: boolean; exact?: boolean }> = [
    { precise: true, exact: true },
    { precise: true },
    {},
  ];

  let bestResult: any | null = null;
  for (const attempt of attempts) {
    const search = await scheduleRawg(() =>
      searchByTitle(identity.title ?? "", {
        precise: attempt.precise,
        exact: attempt.exact,
        pageSize: 5,
      }),
    );
    const results: any[] = Array.isArray(search?.results) ? search.results : [];
    if (results.length > 0) {
      bestResult = results[0];
      break;
    }
  }
  if (!bestResult?.id) {
    return cachedByTitle ?? null;
  }

  const detail = await scheduleRawg(() => getGame(bestResult.id));
  const cacheEntry = mapRawgDetail(detail, identity.title ?? "");
  await upsertRawgGame(cacheEntry);
  await db.identities.update(identity.id, {
    rawgId: cacheEntry.id,
    rawgSlug: cacheEntry.slug,
  } as Partial<Identity>);
  return cacheEntry;
}

function mapRawgDetail(detail: any, fallbackTitle: string): RawgGameCache {
  const title = detail?.name ?? fallbackTitle;
  const titleKey = normalizeTitle(title) ?? title.toLowerCase();
  const genres =
    Array.isArray(detail?.genres) && detail.genres.length
      ? detail.genres.map((g: any) => g?.name).filter(Boolean)
      : [];
  const tags =
    Array.isArray(detail?.tags) && detail.tags.length
      ? detail.tags.map((t: any) => t?.name).filter(Boolean)
      : undefined;
  const platforms =
    Array.isArray(detail?.platforms) && detail.platforms.length
      ? detail.platforms
          .map((p: any) => p?.platform?.name)
          .filter(Boolean)
      : undefined;
  const stores =
    Array.isArray(detail?.stores) && detail.stores.length
      ? detail.stores
          .map((s: any) => ({
            id: s?.store?.id,
            name: s?.store?.name,
            url: s?.url,
            domain: s?.store?.domain ?? null,
          }))
          .filter((s: any) => s.id && s.name)
      : [];
  return {
    id: detail?.id,
    slug: detail?.slug ?? titleKey,
    title,
    titleKey,
    descriptionRaw: detail?.description ?? detail?.description_raw ?? "",
    backgroundImage: detail?.background_image ?? null,
    backgroundImageAdditional: detail?.background_image_additional ?? null,
    genres,
    tags,
    platforms,
    stores,
    developers: Array.isArray(detail?.developers) ? detail.developers.map((d: any) => d?.name).filter(Boolean) : [],
    publishers: Array.isArray(detail?.publishers) ? detail.publishers.map((p: any) => p?.name).filter(Boolean) : [],
    esrb: detail?.esrb_rating?.name ?? null,
    playtimeHours: typeof detail?.playtime === "number" ? detail.playtime : null,
    screenshotsCount: detail?.screenshots_count ?? null,
    metacriticScore: typeof detail?.metacritic === "number" ? detail.metacritic : null,
    rating: typeof detail?.rating === "number" ? detail.rating : null,
    ratingTop: typeof detail?.rating_top === "number" ? detail.rating_top : null,
    ratingsCount: typeof detail?.ratings_count === "number" ? detail.ratings_count : null,
    aggregatedScore:
      typeof detail?.metacritic === "number"
        ? Math.round(detail.metacritic)
        : typeof detail?.rating === "number" && typeof detail?.rating_top === "number" && detail.rating_top > 0
          ? Math.round((detail.rating / detail.rating_top) * 100)
          : null,
    rawgScore: typeof detail?.score === "number" ? detail.score : null,
    released: detail?.released ?? null,
    updatedAtISO: new Date().toISOString(),
  };
}

async function ensureMedia(rawg: RawgGameCache | null): Promise<RawgGameCache | null> {
  if (!rawg) return null;
  if (rawg.screenshots && rawg.movies && !isRawgMediaStale(rawg)) {
    return rawg;
  }
  if (!isVendorEnabled("rawg")) {
    return rawg;
  }
  const [screenshotsResp, moviesResp] = await Promise.all([
    scheduleRawg(() => getScreenshots(rawg.id)),
    scheduleRawg(() => getMovies(rawg.id)),
  ]);
  const screenshots: RawgScreenshot[] = Array.isArray(screenshotsResp?.results)
    ? screenshotsResp.results
        .map((shot: any) => ({
          id: shot?.id,
          image: shot?.image,
          width: shot?.width,
          height: shot?.height,
        }))
        .filter((shot: RawgScreenshot) => Boolean(shot.id && shot.image))
    : [];
  const movies: RawgMovie[] = Array.isArray(moviesResp?.results)
    ? moviesResp.results
        .map((movie: any) => ({
          id: movie?.id,
          name: movie?.name ?? "Trailer",
          preview: movie?.preview ?? null,
          data: movie?.data,
        }))
        .filter((movie: RawgMovie) => Boolean(movie.id))
    : [];

  const merged: RawgGameCache = {
    ...rawg,
    screenshots,
    movies,
    mediaUpdatedAtISO: new Date().toISOString(),
  };
  await upsertRawgGame(merged);
  return merged;
}

async function fetchSteamExtras(identity: Identity, opts?: { prefetch?: boolean }): Promise<SteamExtras> {
  const prefetch = Boolean(opts?.prefetch);
  const appid = identity.appid;
  if (!appid) {
    return {
      price: null,
      news: [],
      achievements: null,
      owned: null,
      recent: null,
      currentPlayers: null,
      refreshed: false,
    };
  }

  let refreshed = false;

  let priceRow = await getSteamPriceRow(appid);
  if (!prefetch && isTauri && isSteamPriceStale(priceRow)) {
    refreshed = true;
    try {
      const fresh = await fetchSteamPriceDetail(appid);
      if (fresh) {
        await upsertSteamPriceRow({
          appid,
          currency: fresh.currency ?? "USD",
          initial: fresh.initial ?? fresh.final ?? 0,
          final: fresh.final ?? fresh.initial ?? 0,
          discountPercent: fresh.discountPercent ?? 0,
          lastFetchedISO: fresh.lastFetchedISO ?? new Date().toISOString(),
        });
        priceRow = await getSteamPriceRow(appid);
      }
    } catch {
      /* noop */
    }
  }
  const price = toSteamPriceSummary(priceRow ?? undefined);

  let newsRow = prefetch ? undefined : await getSteamNewsRow(appid);
  if (!prefetch && isTauri && isSteamNewsStale(newsRow)) {
    refreshed = true;
    try {
      const freshNews = await fetchSteamNews(appid, 6);
      await upsertSteamNewsRow({
        appid,
        items: freshNews ?? [],
        lastFetchedISO: new Date().toISOString(),
      });
      newsRow = await getSteamNewsRow(appid);
    } catch {
      /* noop */
    }
  }
  const news: SteamNewsItem[] = Array.isArray(newsRow?.items) ? newsRow.items.slice(0, 6) : [];

  let playerCountRow = await getSteamPlayerCountRow(appid);
  if (!prefetch && isTauri && isSteamPlayerCountStale(playerCountRow)) {
    refreshed = true;
    try {
      const count = await getCurrentPlayers(appid);
      if (count != null) {
        await upsertSteamPlayerCountRow({
          appid,
          playerCount: count,
          lastFetchedISO: new Date().toISOString(),
        });
        playerCountRow = await getSteamPlayerCountRow(appid);
      }
    } catch {
      /* noop */
    }
  }
  const currentPlayers = playerCountRow?.playerCount ?? null;

  if (prefetch) {
    return {
      price,
      news: [],
      achievements: null,
      owned: null,
      recent: null,
      currentPlayers,
      refreshed,
    };
  }

  let steamId: string | null = null;
  try {
    const stored = await getSetting<string>("steam.myId");
    steamId = stored ?? null;
  } catch {
    steamId = null;
  }

  let ownedRow: SteamOwnedRow | undefined;
  let recentRow: SteamRecentRow | undefined;
  let achievementsRow: SteamAchievementsRow | undefined;
  let schemaRow = await getSteamSchemaRow(appid);

  if (steamId) {
    const ownedRows = await getSteamOwnedRows(steamId);
    ownedRow = ownedRows.find((row) => row.appid === appid);
    if (isTauri && isSteamOwnedStale(ownedRow ? [ownedRow] : [])) {
      refreshed = true;
      try {
        const ownedGames = await getOwnedGames(steamId, true);
        const target = ownedGames.find((game) => game.appId === appid);
        if (target) {
          const timestamp = new Date().toISOString();
          const row: SteamOwnedRow = {
            steamid: steamId,
            appid,
            name: target.name,
            playtimeForeverMin: target.playtimeForeverMin,
            playtimeTwoWeeksMin: target.playtimeTwoWeeksMin ?? null,
            lastPlayedAt: target.lastPlayedAt ?? null,
            hasVisibleStats: target.hasVisibleStats,
            iconHash: target.iconHash ?? null,
            logoHash: target.logoHash ?? null,
            playtimeWindowsMin: target.playtimeWindowsMin ?? null,
            playtimeMacMin: target.playtimeMacMin ?? null,
            playtimeLinuxMin: target.playtimeLinuxMin ?? null,
            contentDescriptorIds: target.contentDescriptorIds ?? null,
            lastFetchedISO: timestamp,
          };
          await db.steamOwned.put(row);
          ownedRow = row;
        }
      } catch {
        /* noop */
      }
    }

    const recentRows = await getSteamRecentRows(steamId);
    recentRow = recentRows.find((row) => row.appid === appid);
    if (isTauri && isSteamRecentStale(recentRow)) {
      refreshed = true;
      try {
        const recentlyPlayed = await getRecentlyPlayed(steamId);
        const timestamp = new Date().toISOString();
        const targetRecent = recentlyPlayed.find((game) => game.appId === appid);
        if (targetRecent) {
          const row: SteamRecentRow = {
            steamid: steamId,
            appid,
            name: targetRecent.name,
            playtimeTwoWeeksMin: targetRecent.playtimeTwoWeeksMin ?? null,
            playtimeForeverMin: targetRecent.playtimeForeverMin ?? null,
            lastPlayedAt: targetRecent.lastPlayedAt ?? null,
            iconHash: targetRecent.iconHash ?? null,
            logoHash: targetRecent.logoHash ?? null,
            lastFetchedISO: timestamp,
          };
          await db.steamRecent.put(row);
          recentRow = row;
        }
      } catch {
        /* noop */
      }
    }

    achievementsRow = await getSteamAchievementsRow(steamId, appid);
    if (isTauri && isSteamAchievementsStale(achievementsRow)) {
      refreshed = true;
      try {
        const achievementsFresh = await getPlayerAchievements(steamId, appid);
        if (achievementsFresh) {
          await upsertSteamAchievementsRow({
            steamid: steamId,
            appid,
            unlocked: achievementsFresh.unlocked,
            total: achievementsFresh.total,
            items: achievementsFresh.items.map((item) => ({
              apiName: item.apiName,
              achieved: item.achieved,
              unlockTime: item.unlockTime ?? null,
            })),
            lastFetchedISO: achievementsFresh.lastFetchedISO ?? new Date().toISOString(),
          });
          achievementsRow = await getSteamAchievementsRow(steamId, appid);
        }
      } catch {
        /* noop */
      }
    }
  }

  if (!prefetch && isTauri && isSteamSchemaStale(schemaRow)) {
    refreshed = true;
    try {
      const schema = await getSchemaForGame(appid);
      if (schema) {
        await upsertSteamSchemaRow({
          appid,
          items: schema.items ?? [],
          lastFetchedISO: schema.lastFetchedISO ?? new Date().toISOString(),
        });
        schemaRow = await getSteamSchemaRow(appid);
      }
    } catch {
      /* noop */
    }
  }


  return {
    price,
    news,
    achievements: toAchievementsView(achievementsRow, schemaRow?.items ?? []),
    owned: toPlaytimeSummary(ownedRow ?? null),
    recent: toPlaytimeSummary(recentRow ?? null),
    currentPlayers,
    refreshed,
  };
}

function pickFirstNumber<T>(values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (value != null && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

async function buildViewModel(
  identity: Identity,
  libraryItems: LibraryItem[],
  rawg: RawgGameCache | null,
  flags: { rawgEnabled: boolean; metacriticEnabled: boolean },
  steamExtras: SteamExtras,
): Promise<GameDetailsData> {
  const sanitizedDescription = sanitizeHtml(rawg?.descriptionRaw ?? "");
  const backgroundImage = rawg?.backgroundImage ?? rawg?.backgroundImageAdditional ?? null;
  const { coverUrl, alt: coverAlt } = computeCover(identity, rawg);

  const primaryItem = libraryItems[0] ?? null;
  const ocScore = pickFirstNumber([identity.ocScore, primaryItem?.ocScore]);
  const mcScoreRaw = pickFirstNumber([identity.mcScore, primaryItem?.mcScore]);
  const mcScore = flags.metacriticEnabled ? mcScoreRaw : null;
  const rawgScore = flags.rawgEnabled ? rawg?.aggregatedScore ?? rawg?.metacriticScore ?? null : null;

  const criticBadge =
    mcScore != null
      ? {
          value: mcScore,
          source: "metacritic" as const,
          label: "MC",
          aria: `Metacritic score ${mcScore}`,
        }
      : ocScore != null
        ? {
            value: ocScore,
            source: "opencritic" as const,
            label: "OC",
            aria: `OpenCritic score ${ocScore}`,
          }
        : rawgScore != null
          ? {
              value: rawgScore,
              source: "rawg" as const,
              label: "RAWG",
              aria: `RAWG rating ${rawgScore}`,
            }
          : undefined;

  const criticSources: GameDetailsData["criticSources"] = [
    { source: "Metacritic", value: mcScore },
    { source: "OpenCritic", value: ocScore },
    { source: "RAWG", value: rawgScore },
  ];

  const identityTtb = identity.ttbMedianMainH ?? null;
  const identityTtbSource = identity.ttbSource ?? null;
  const libraryTtb = pickFirstNumber(libraryItems.map((item) => item.ttbMedianMainH ?? null));
  const rawgTtb = flags.rawgEnabled ? rawg?.playtimeHours ?? null : null;

  let ttbValue: number | null = null;
  let ttbSourceLabel: string | null = null;

  if (identityTtb != null) {
    ttbValue = identityTtb;
    if (identityTtbSource && identityTtbSource.toLowerCase().includes("rawg")) {
      ttbSourceLabel = "RAWG";
    } else if (identityTtbSource && identityTtbSource.toLowerCase().includes("hltb")) {
      ttbSourceLabel = "HLTB";
    } else if (identityTtbSource) {
      ttbSourceLabel = identityTtbSource.toUpperCase();
    } else {
      ttbSourceLabel = "TTB";
    }
  } else if (libraryTtb != null) {
    ttbValue = libraryTtb;
    ttbSourceLabel = "HLTB";
  } else if (rawgTtb != null) {
    ttbValue = rawgTtb;
    ttbSourceLabel = "RAWG";
  }

  const ttbAria =
    ttbValue != null ? `${ttbSourceLabel ?? "Time to beat"} ${ttbValue} hours` : "Time to beat data unavailable";

  return {
    identity,
    libraryItems,
    rawg,
    sanitizedDescription,
    backgroundImage,
    coverUrl,
    coverAlt,
    criticBadge,
    criticSources,
    ttb: {
      value: ttbValue,
      sourceLabel: ttbSourceLabel,
      aria: ttbAria,
    },
    genres: rawg?.genres ?? [],
    tags: rawg?.tags ?? [],
    developers: rawg?.developers ?? [],
    publishers: rawg?.publishers ?? [],
    releaseDate: rawg?.released ?? null,
    esrb: rawg?.esrb ?? null,
    stores: rawg?.stores ?? [],
    screenshots: rawg?.screenshots ?? [],
    movies: rawg?.movies ?? [],
    ocScore,
    mcScore,
    rawgScore,
    steamPrice: steamExtras.price,
    steamNews: steamExtras.news,
    steamAchievements: steamExtras.achievements,
    steamOwned: steamExtras.owned,
    steamRecent: steamExtras.recent,
    steamCurrentPlayers: steamExtras.currentPlayers,
    steamRefreshed: steamExtras.refreshed,
  };
}

type EnsureGameDetailsOptions = {
  prefetch?: boolean;
  rawgEnabled?: boolean;
  metacriticEnabled?: boolean;
};

async function ensureGameDetails(identityId: string, opts: EnsureGameDetailsOptions = {}): Promise<GameDetailsData> {
  const memory = fromMemory(identityId);
  if (memory) return memory;

  const identity = await db.identities.get(identityId);
  if (!identity) {
    throw new Error("Identity not found");
  }
  const libraryItems = await loadLibraryItems(identityId);
  const allowRawg = opts.rawgEnabled ?? isVendorEnabled("rawg");
  const allowMetacritic = opts.metacriticEnabled ?? isVendorEnabled("metacritic");
  let rawg: RawgGameCache | null = null;
  if (allowRawg) {
    rawg = await resolveRawgDetail(identity);
  }

  if (allowRawg && !opts.prefetch) {
    rawg = await ensureMedia(rawg);
  }

  const steamExtras = await fetchSteamExtras(identity, { prefetch: opts.prefetch });

  const data = await buildViewModel(
    identity,
    libraryItems,
    allowRawg ? rawg : null,
    {
      rawgEnabled: allowRawg,
      metacriticEnabled: allowMetacritic,
    },
    steamExtras,
  );
  if (!opts.prefetch) {
    remember(identityId, data);
  }
  return data;
}

export function markGameDetailsOpened(id: string) {
  lastOpened = { id, time: Date.now() };
}

export function prefetchGameDetails(id: string) {
  if (!id) return;
  const lastOpen = lastOpened;
  if (lastOpen && lastOpen.id === id && Date.now() - lastOpen.time < PREFETCH_COOLDOWN_MS) {
    return;
  }
  if (fromMemory(id)) return;
  if (pendingPrefetch.has(id)) return;
  const task = ensureGameDetails(id, { prefetch: true }).catch(() => {}).finally(() => {
    pendingPrefetch.delete(id);
  });
  pendingPrefetch.set(id, task.then(() => {}));
}

export function invalidateGameDetails(id: string): void {
  if (!id) return;
  inMemoryCache.delete(id);
  pendingPrefetch.delete(id);
}

let lastSteamUserId: string | null = null;

export function resetSteamUserIdCache(next?: string | null): void {
  const normalized = next ?? null;
  if (lastSteamUserId === normalized) {
    return;
  }
  lastSteamUserId = normalized;
  inMemoryCache.clear();
  pendingPrefetch.clear();
}

function useGameDetails(
  identityId: string,
  flags: { rawgEnabled: boolean; metacriticEnabled: boolean },
): GameDetailsState {
  const [state, setState] = useState<GameDetailsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    ensureGameDetails(identityId, {
      rawgEnabled: flags.rawgEnabled,
      metacriticEnabled: flags.metacriticEnabled,
    })
      .then((data) => {
        if (cancelled) return;
        setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: (err as Error)?.message ?? "Failed to load details." });
      });
    return () => {
      cancelled = true;
    };
  }, [identityId, flags.rawgEnabled, flags.metacriticEnabled]);

  return state;
}

function formatCurrency(code?: string | null) {
  if (!code) return "";
  const map: Record<string, string> = {
    USD: "$",
    EUR: "Γé¼",
    GBP: "┬ú",
    JPY: "┬Ñ",
    TRY: "TRY",
  };
  return map[code.toUpperCase()] ?? code.toUpperCase();
}

function formatReleaseDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-1/2 animate-pulse rounded bg-zinc-200" />
      <div className="h-48 w-full animate-pulse rounded bg-zinc-200" />
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-zinc-200" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-200" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-200" />
      </div>
    </div>
  );
}

function useTab(initialTab: string) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const setTab = useCallback((tab: string) => {
    setActiveTab(tab);
  }, []);
  return { activeTab, setTab };
}

type TabKey = "media" | "overview" | "stores" | "news" | "achievements";

const TAB_CONFIG: Array<{ key: TabKey; label: string; description: string }> = [
  { key: "media", label: "Media", description: "Screenshots and trailers" },
  { key: "overview", label: "Overview", description: "Summary and credits" },
  { key: "stores", label: "Stores", description: "Where to buy" },
  { key: "news", label: "News", description: "Steam community updates" },
  { key: "achievements", label: "Achievements", description: "Personal progress" },
];

function ScoreBadge({ badge }: { badge: GameDetailsData["criticBadge"] }) {
  if (!badge) return null;
  const baseClass =
    badge.source === "metacritic"
      ? "bg-blue-600"
      : badge.source === "opencritic"
        ? "bg-emerald-600"
        : "bg-indigo-600";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-white",
        baseClass,
      )}
      aria-label={badge.aria}
    >
      <span>{badge.label}</span>
      <span>{badge.value}</span>
    </span>
  );
}

function TtbBadge({ ttb }: { ttb: GameDetailsData["ttb"] }) {
  if (ttb.value == null) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-700"
      aria-label={ttb.aria}
    >
      <span>{ttb.sourceLabel ?? "TTB"}</span>
      <span>{ttb.value}h</span>
    </span>
  );
}

function MediaTab({
  backgroundImage,
  screenshots,
  movies,
}: {
  backgroundImage: string | null;
  screenshots: RawgScreenshot[];
  movies: RawgMovie[];
}) {
  const [selectedShot, setSelectedShot] = useState(0);
  const hero = screenshots[selectedShot] ?? screenshots[0];

  return (
    <div className="space-y-4">
      {hero ? (
        <img
          src={hero.image}
          alt="Gameplay screenshot"
          className="w-full rounded-lg border border-zinc-200 object-cover"
        />
      ) : backgroundImage ? (
        <img
          src={backgroundImage}
          alt="Background artwork"
          className="w-full rounded-lg border border-zinc-200 object-cover"
        />
      ) : (
        <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-500">
          No media available.
        </div>
      )}

      {screenshots.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {screenshots.slice(0, 10).map((shot, index) => (
            <button
              key={shot.id}
              type="button"
              onClick={() => setSelectedShot(index)}
              className={clsx(
                "h-20 w-32 flex-shrink-0 overflow-hidden rounded border",
                selectedShot === index ? "border-emerald-600" : "border-transparent",
              )}
              aria-label={`Screenshot ${index + 1}`}
            >
              <img src={shot.image} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {movies.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-zinc-700">Trailers</h3>
          {movies.slice(0, 3).map((movie) => {
            const source = movie.data?.max ?? movie.data?.["480"] ?? movie.preview;
            if (!source) return null;
            return (
              <video key={movie.id} controls className="w-full rounded-lg border border-zinc-200">
                <source src={source} />
                Your browser does not support embedded video.
              </video>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ data }: { data: GameDetailsData }) {
  const { sanitizedDescription, genres, developers, publishers, releaseDate, esrb, tags, rawg, criticSources } = data;
  const overviewHeadingId = "game-details-overview-heading";
  const descriptionBodyId = "game-details-description";
  const shortTags = tags.length ? tags.slice(0, 10) : [];
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
        <h3 className="text-sm font-semibold text-zinc-800">Critic sources</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {criticSources.length ? (
            criticSources.map((score) => (
              <span
                key={score.source}
                className={clsx(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  score.value != null ? "bg-emerald-600/10 text-emerald-700" : "bg-zinc-100 text-zinc-400",
                )}
              >
                <span>{score.source}</span>
                <span className="font-semibold">{score.value != null ? score.value : "—"}</span>
              </span>
            ))
          ) : (
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-400">
              No critic data yet
            </span>
          )}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Genres</h4>
          <p className="text-sm text-zinc-700">{genres.length ? genres.join(", ") : "-"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Tags</h4>
          <p className="text-sm text-zinc-700">{shortTags.length ? shortTags.join(", ") : "-"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Developers</h4>
          <p className="text-sm text-zinc-700">{developers.length ? developers.join(", ") : "-"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Publishers</h4>
          <p className="text-sm text-zinc-700">{publishers.length ? publishers.join(", ") : "-"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Release Date</h4>
          <p className="text-sm text-zinc-700">{releaseDate ?? "-"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">ESRB</h4>
          <p className="text-sm text-zinc-700">{esrb ?? "-"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">RAWG Link</h4>
          {rawg?.slug ? (
            <a
              href={`https://rawg.io/games/${rawg.slug}`}
              target="_blank"
              rel="noopener"
              className="text-sm text-emerald-600 hover:underline"
            >
              Open on RAWG
            </a>
          ) : (
            <span className="text-sm text-zinc-700">-</span>
          )}
        </div>
      </section>

      <section aria-labelledby={overviewHeadingId}>
        <h3 id={overviewHeadingId} className="text-sm font-semibold text-zinc-700">
          Overview
        </h3>
        {sanitizedDescription ? (
          <div
            id={descriptionBodyId}
            className="prose prose-sm max-w-none text-zinc-700"
            dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
          />
        ) : (
          <p id={descriptionBodyId} className="text-sm text-zinc-500">
            No description available.
          </p>
        )}
      </section>
    </div>
  );
}

function StoresTab({ stores }: { stores: RawgStoreInfo[] }) {
  if (!stores.length) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-200 bg-white p-4 text-sm text-zinc-500">
        No store links available.
      </p>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {stores.map((store) => {
        const info = getStoreInfo(store.id) ?? { name: store.name };
        const href = store.url ?? (store.domain ? `https://${store.domain}` : undefined);
        const badge = info.name?.slice(0, 2).toUpperCase();
        const iconText = (badge ?? "").trim();
        return (
          <a
            key={`${store.id}-${store.url ?? store.name}`}
            href={href}
            target="_blank"
            rel="noopener"
            title={info.name}
            className="group flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm font-medium text-emerald-700 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <span className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-600/10 text-xs font-semibold text-emerald-700">
                {iconText || "?"}
              </span>
              <span>{info.name}</span>
            </span>
            {info?.name && info.name.toLowerCase().includes("steam") ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                PC
              </span>
            ) : null}
          </a>
        );
      })}
    </div>
  );
}

function NewsTab({ items }: { items: SteamNewsItem[] }) {
  if (!items.length) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-inner">
        No recent Steam news for this game.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const date = item.date ? new Date(item.date * 1000) : null;
        const summary = item.contents
          ? item.contents.replace(/\[[^\]]*\]/g, "").replace(/<[^>]+>/g, "").slice(0, 240)
          : null;
        return (
          <article key={item.gid} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold text-zinc-900">{item.title || "Steam update"}</h4>
              {date ? <span className="text-xs text-zinc-500">{date.toLocaleDateString()}</span> : null}
            </header>
            {summary ? (
              <p className="mt-2 text-sm text-zinc-600">{summary}{summary.length === 240 ? "..." : ""}</p>
            ) : null}
            <div className="mt-3">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-emerald-600 hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                Read on Steam
              </a>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AchievementsTab({ data, appid }: { data: GameDetailsData["steamAchievements"]; appid: number | null }) {
  if (!data) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-inner">
        Connect your Steam account to track achievement progress.
      </div>
    );
  }
  if (!data.items.length) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-inner">
        No achievements recorded yet. Launch the game to start tracking progress.
      </div>
    );
  }
  const progress = data.total > 0 ? Math.min(100, Math.round((data.unlocked / data.total) * 100)) : 0;
  const recent = data.items.slice(0, 8);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-zinc-900">Achievements unlocked</h4>
            <p className="text-xs text-zinc-500">
              {data.unlocked} of {data.total} ({progress}%)
            </p>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-zinc-200">
          <div
            className="h-2 rounded-full bg-emerald-500"
            style={{ width: `${progress}%` }}
            aria-label={`Unlocked ${data.unlocked} of ${data.total} achievements`}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {recent.map((item) => {
          const icon = item.icon || item.iconGray || null;
          const unlocked = item.achieved && item.unlockTime;
          const unlockDate = unlocked ? new Date((item.unlockTime ?? 0) * 1000) : null;
          return (
            <div
              key={item.apiName}
              className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm"
            >
              {icon ? (
                <img src={icon} alt="" className="h-10 w-10 flex-shrink-0 rounded" loading="lazy" />
              ) : (
                <div className="h-10 w-10 flex-shrink-0 rounded bg-zinc-200" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900">{item.displayName}</p>
                {item.description ? <p className="text-xs text-zinc-500">{item.description}</p> : null}
                <p className="mt-1 text-xs font-medium text-emerald-600">
                  {item.achieved
                    ? unlockDate
                      ? `Unlocked ${unlockDate.toLocaleDateString()}`
                      : "Unlocked"
                    : "Locked"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      {appid ? (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm text-emerald-700">
          <a
            href={`https://steamcommunity.com/stats/${appid}/achievements/`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold hover:underline"
          >
            View full achievement list on Steam
          </a>
        </div>
      ) : null}
    </div>
  );
}

type GameDetailsVariant = "full" | "compact";

export default function GameDetails({
  identityId,
  variant = "full",
}: {
  identityId: string;
  variant?: GameDetailsVariant;
}) {
  const rawgEnabled = useVendorFlag("rawg");
  const metacriticEnabled = useVendorFlag("metacritic");
  const state = useGameDetails(identityId, { rawgEnabled, metacriticEnabled });
  const { activeTab, setTab } = useTab(variant === "compact" ? "overview" : "media");
  const tabBaseId = useId();
  const [sessionMedian, setSessionMedian] = useState<number>(0);
  const [planOpen, setPlanOpen] = useState(false);
  const [planRow, setPlanRow] = useState<PlanRow | null>(null);
  const [planSaving, setPlanSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planUpdatingIndex, setPlanUpdatingIndex] = useState<number | null>(null);

  useEffect(() => {
    if (state.status === "ready") {
      markGameDetailsOpened(identityId);
    }
  }, [identityId, state.status]);

  useEffect(() => {
    let cancelled = false;
    setPlanRow(null);
    setPlanOpen(false);
    setPlanError(null);
    setPlanSaving(false);
    setPlanUpdatingIndex(null);
    (async () => {
      try {
        const existing = await getPlanForIdentity(identityId);
        if (!cancelled) {
          setPlanRow(existing ?? null);
        }
      } catch (error) {
        console.error("Failed to load finish plan", error);
        if (!cancelled) {
          setPlanRow(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identityId]);

  useEffect(() => {
    let cancelled = false;
    async function loadMedian() {
      try {
        const sessions = await recentSessions(10);
        const median = modalSessionMinutes(sessions);
        if (!cancelled) setSessionMedian(median);
      } catch (error) {
        console.error("Failed to compute session median", error);
        if (!cancelled) setSessionMedian(0);
      }
    }
    void loadMedian();
    return () => {
      cancelled = true;
    };
  }, []);

  const data = state.status === "ready" ? state.data : null;
  const primaryEntry = data?.libraryItems[0] ?? null;

  const priceInfo = useMemo(() => {
    if (!data) return null;
    if (data.steamPrice) {
      const amount = Number(data.steamPrice.amount);
      if (Number.isFinite(amount)) {
        const currencyCode = data.steamPrice.currency || "USD";
        const symbol = formatCurrency(currencyCode);
        return {
          amount,
          currencyCode,
          symbol,
          label: `${symbol} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
          source: "steam" as const,
          discountPercent: data.steamPrice.discountPercent ?? 0,
        };
      }
    }
    const entry = data.libraryItems[0];
    if (entry?.priceTRY != null) {
      const amount = Number(entry.priceTRY);
      if (Number.isFinite(amount)) {
        const currencyCode = entry.currencyCode ?? "TRY";
        const symbol = formatCurrency(currencyCode);
        return {
          amount,
          currencyCode,
          symbol,
          label: `${symbol} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
          source: "library" as const,
          discountPercent: null,
        };
      }
    }
    return null;
  }, [data]);

  const valuePerHour = useMemo(() => {
    if (!data || !priceInfo) return null;
    const hours = data.ttb.value;
    if (hours == null || !Number.isFinite(hours) || hours <= 0) return null;
    const value = pricePerHour(priceInfo.amount, hours);
    if (value == null) return null;
    return `${priceInfo.symbol} ${value}`;
  }, [data, priceInfo]);

  const steamStats = useMemo(() => {
    if (!data) return null;
    const owned = data.steamOwned;
    const recent = data.steamRecent;
    if (!owned && !recent) return null;
    const formatHours = (minutes?: number | null) => {
      if (minutes == null || !Number.isFinite(minutes)) return "—";
      const hours = minutes / 60;
      return hours >= 10 ? `${Math.round(hours)} h` : `${Math.round(hours * 10) / 10} h`;
    };
    const total = formatHours(owned?.playtimeForeverMin ?? recent?.playtimeForeverMin);
    const recentLabel = formatHours(recent?.playtimeTwoWeeksMin ?? owned?.playtimeTwoWeeksMin);
    const lastPlayedISO = recent?.lastPlayedAtISO ?? owned?.lastPlayedAtISO ?? null;
    const lastPlayed = lastPlayedISO ? new Date(lastPlayedISO).toLocaleDateString() : null;
    return { total, recent: recentLabel, lastPlayed };
  }, [data]);

  const remainingHours = useMemo(() => {
    if (!data) return null;
    const totalTtb = data.ttb.value;
    if (totalTtb == null || !Number.isFinite(totalTtb)) return null;
    const playedMinutes =
      data.steamOwned?.playtimeForeverMin ??
      data.libraryItems[0]?.playtimeForeverMin ??
      null;
    const playedHours = playedMinutes != null && Number.isFinite(playedMinutes) ? playedMinutes / 60 : 0;
    const remaining = Math.max(totalTtb - playedHours, 0);
    if (!Number.isFinite(remaining) || remaining <= 0) return 0;
    return remaining;
  }, [data]);

  const planPreview: PlannerResult | null = useMemo(() => {
    if (remainingHours == null || remainingHours <= 0) return null;
    return planSessions(remainingHours, sessionMedian);
  }, [remainingHours, sessionMedian]);

  const previewSteps: PlanStep[] = useMemo(() => {
    if (!planPreview?.steps.length) return [];
    return planPreview.steps.map((step: PlannerStep) => ({
      minutes: step.minutes,
      done: false,
      dateSuggestion: step.dateSuggestion ?? null,
    }));
  }, [planPreview]);

  const planSteps = planRow?.steps ?? previewSteps;
  const hasPlan = planSteps.length > 0;
  const planSessionsCount = planSteps.length;

  const totalPlanMinutes = useMemo(
    () => planSteps.reduce((sum: number, step: PlanStep) => sum + step.minutes, 0),
    [planSteps],
  );
  const totalPlanHours = useMemo(() => Math.round((totalPlanMinutes / 60) * 10) / 10, [totalPlanMinutes]);
  const planCompletedCount =
    planRow?.doneCount ?? planSteps.filter((step: PlanStep) => step.done).length;

  useEffect(() => {
    if (!hasPlan) {
      setPlanOpen(false);
    }
  }, [hasPlan]);

  const handlePlanToggle = useCallback(async () => {
    if (planOpen) {
      setPlanOpen(false);
      return;
    }
    if (!planRow && !previewSteps.length) {
      setPlanError("Not enough data to build a plan yet.");
      return;
    }
    let planAvailable = Boolean(planRow && planRow.steps?.length);
    if (!planRow && previewSteps.length) {
      setPlanSaving(true);
      setPlanError(null);
      try {
        await savePlan(identityId, previewSteps);
        const latest = await getPlanForIdentity(identityId);
        if (latest) {
          setPlanRow(latest);
          planAvailable = true;
        }
      } catch (error) {
        console.error("Failed to save finish plan", error);
        setPlanError("Unable to build a plan right now.");
        planAvailable = false;
      } finally {
        setPlanSaving(false);
      }
    }
    if (planAvailable || previewSteps.length) {
      setPlanError(null);
      setPlanOpen(true);
    }
  }, [planOpen, planRow, previewSteps, identityId]);

  const handleRegeneratePlan = useCallback(async () => {
    if (!previewSteps.length) return;
    setPlanSaving(true);
    setPlanError(null);
    try {
      await savePlan(identityId, previewSteps);
      const latest = await getPlanForIdentity(identityId);
      if (latest) {
        setPlanRow(latest);
        setPlanOpen(true);
      }
    } catch (error) {
      console.error("Failed to refresh plan", error);
      setPlanError("Unable to refresh the plan right now.");
    } finally {
      setPlanSaving(false);
    }
  }, [identityId, previewSteps]);

  const handleTogglePlanStep = useCallback(
    async (index: number) => {
      if (!planRow || planRow.id == null) return;
      if (index < 0 || index >= planRow.steps.length) return;
      const updated = planRow.steps.map((step: PlanStep, idx: number) =>
        idx === index ? { ...step, done: !step.done } : step,
      );
      setPlanUpdatingIndex(index);
      try {
        await updatePlan(planRow.id, updated);
        setPlanRow((prev) => {
          if (!prev || prev.id !== planRow.id) return prev;
          return {
            ...prev,
            steps: updated,
            doneCount: updated.filter((step: PlanStep) => step.done).length,
            updatedAtISO: new Date().toISOString(),
          };
        });
      } catch (error) {
        console.error("Failed to toggle plan step", error);
      } finally {
        setPlanUpdatingIndex(null);
      }
    },
    [planRow],
  );

  if (state.status === "error") {
    return (
      <div className="space-y-4">
        <h2 id="game-details-title" className="text-xl font-semibold text-zinc-800">
          Unable to load game details
        </h2>
        <p className="text-sm text-red-600">{state.message}</p>
      </div>
    );
  }

  if (!data) {
    return <DetailSkeleton />;
  }

  const releaseDisplay = formatReleaseDate(data.releaseDate);
  const genreHighlights = data.genres.slice(0, 4);
  const currentPlayersLabel =
    data.steamCurrentPlayers != null
      ? data.steamCurrentPlayers.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : null;
  const appid = data.identity.appid ?? null;
  const steamStoreUrl = appid ? `https://store.steampowered.com/app/${appid}/` : null;
  const steamOwned = data.steamOwned;
  const steamRecent = data.steamRecent;
  const installed = Boolean(
    primaryEntry?.installed ||
      (steamOwned?.playtimeForeverMin != null && steamOwned.playtimeForeverMin > 0) ||
      steamOwned?.playtimeTwoWeeksMin ||
      steamOwned?.lastPlayedAtISO ||
      steamRecent?.playtimeForeverMin ||
      steamRecent?.lastPlayedAtISO,
  );
  const primaryActionHref =
    appid != null ? (installed ? `steam://run/${appid}` : `steam://install/${appid}`) : null;
  const priceSourceLabel =
    priceInfo?.source === "steam" ? "Steam" : priceInfo?.source === "library" ? "Library" : null;

  const tabButtonId = (key: TabKey) => `${tabBaseId}-${key}-tab`;
  const tabPanelId = (key: TabKey) => `${tabBaseId}-${key}-panel`;
  const showHero = variant === "full";
  const prioritizedCritic =
    data.criticBadge?.value != null
      ? { value: data.criticBadge.value, source: data.criticBadge.label }
      : data.criticSources.find((source) => source.value != null) ?? null;
  const criticSnapshotLabel = prioritizedCritic
    ? `${prioritizedCritic.value} (${prioritizedCritic.source})`
    : "-";

  return (
    <div
      className="space-y-6"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {showHero ? (
        <section className="rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 id="game-details-title" className="text-2xl font-semibold leading-tight text-zinc-900">
                {data.identity.title ?? "Untitled game"}
              </h2>
              {primaryEntry?.status ? (
                <p className="text-sm text-zinc-500">
                  Library status <span className="font-medium text-zinc-700">{primaryEntry.status}</span>
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-start gap-3">
              <div className="h-28 w-20 overflow-hidden rounded border border-zinc-200 bg-zinc-100">
                <GameCover identity={data.identity} size="md" />
              </div>
              {appid ? (
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                  {primaryActionHref ? (
                    <a
                      href={primaryActionHref}
                      className="btn rounded-full px-4 py-2 text-sm font-semibold"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {installed ? "Play" : "Install"}
                    </a>
                  ) : null}
                  {steamStoreUrl ? (
                    <a
                      href={steamStoreUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-ghost rounded-full px-4 py-2 text-sm font-semibold"
                      onClick={(event) => event.stopPropagation()}
                    >
                      Open Store
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          {!rawgEnabled && (
            <p className="mt-2 text-xs text-zinc-500">
              RAWG integration is disabled. Media and critic data are limited to cached sources.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {data.criticBadge ? <ScoreBadge badge={data.criticBadge} /> : null}
            <TtbBadge ttb={data.ttb} />
            {priceInfo ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                Price {priceInfo.label}
                {priceInfo.source === "steam" && priceInfo.discountPercent != null && priceInfo.discountPercent > 0 ? (
                  <span className="ml-1 text-[11px] font-medium text-emerald-600">-{priceInfo.discountPercent}%</span>
                ) : null}
              </span>
            ) : null}
            {valuePerHour ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                Value {valuePerHour}/h
              </span>
            ) : null}
            {data.steamRefreshed ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                Steam data refreshed
              </span>
            ) : null}
            {currentPlayersLabel ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                Players now {currentPlayersLabel}
              </span>
            ) : null}
            {data.identity.platform ? (
              <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700">
                {data.identity.platform}
              </span>
            ) : null}
            {genreHighlights.map((genre) => (
              <span
                key={genre}
                className="rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600"
              >
                {genre}
              </span>
            ))}
          </div>
          {releaseDisplay ? (
            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-emerald-500">Released {releaseDisplay}</p>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
        <h3 className="text-sm font-semibold text-zinc-800">Your data</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-emerald-50 bg-emerald-50/80 p-4 shadow-inner">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Library snapshot</h4>
            <dl className="mt-3 space-y-2 text-sm text-zinc-600">
              <div className="flex items-center justify-between">
                <dt>Status</dt>
                <dd className="font-medium text-zinc-900">{primaryEntry?.status ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Entries</dt>
                <dd className="font-medium text-zinc-900">{data.libraryItems.length}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Time to beat</dt>
                <dd className="font-medium text-zinc-900">{data.ttb.value != null ? `${data.ttb.value}h` : "-"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Critic score</dt>
                <dd className="font-medium text-zinc-900">{criticSnapshotLabel}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>TTB source</dt>
                <dd className="font-medium text-zinc-900">{data.ttb.sourceLabel ?? "-"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Purchase price</dt>
                <dd className="font-medium text-zinc-900">
                  {priceInfo ? (
                    <span>
                      {priceInfo.label}
                      {priceSourceLabel ? (
                        <span className="ml-1 text-xs text-emerald-600">({priceSourceLabel})</span>
                      ) : null}
                    </span>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Value / h</dt>
                <dd className="font-medium text-zinc-900">{valuePerHour ? `${valuePerHour}/h` : "—"}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-inner">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Steam play history</h4>
            {steamStats ? (
              <dl className="mt-3 space-y-2 text-sm text-zinc-600">
                <div className="flex items-center justify-between">
                  <dt>Total playtime</dt>
                  <dd className="font-medium text-zinc-900">{steamStats.total}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt>Last 2 weeks</dt>
                  <dd className="font-medium text-zinc-900">{steamStats.recent}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt>Last played</dt>
                  <dd className="font-medium text-zinc-900">{steamStats.lastPlayed ?? "Not recorded"}</dd>
                </div>
                {currentPlayersLabel ? (
                  <div className="flex items-center justify-between">
                    <dt>Players now</dt>
                    <dd className="font-medium text-zinc-900">{currentPlayersLabel}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">
                Add your Steam ID in Settings to track recent playtime.
              </p>
            )}
          </div>
        </div>
      </section>

      {hasPlan || previewSteps.length ? (
        <section className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-inner">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Finish planner</h3>
              <p className="mt-1 text-sm text-zinc-700">
                Approximately {planSessionsCount} session{planSessionsCount === 1 ? "" : "s"} (~{totalPlanHours}h remaining) based
                on your median session of {sessionMedian > 0 ? sessionMedian : "?"} minutes.
              </p>
              {planRow ? (
                <p className="mt-1 text-xs font-medium text-emerald-600">
                  Progress: {planCompletedCount} / {planSessionsCount} steps complete
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {planRow ? (
                <button
                  type="button"
                  className="rounded-full border border-emerald-200 px-4 py-2 text-xs font-semibold text-emerald-600 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-60"
                  onClick={handleRegeneratePlan}
                  disabled={planSaving || !previewSteps.length}
                >
                  {planSaving ? "Rebuilding..." : "Refresh plan"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={handlePlanToggle}
                disabled={planSaving}
                className="rounded-full border border-emerald-300 px-4 py-2 text-xs font-semibold text-emerald-600 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60"
              >
                {planSaving
                  ? "Saving..."
                  : planOpen
                    ? "Hide plan"
                    : planRow
                      ? "View plan"
                      : "Build plan"}
              </button>
            </div>
          </div>
          {planError ? <p className="mt-2 text-sm text-rose-600">{planError}</p> : null}
          {planOpen ? (
            <ol className="mt-3 space-y-2 text-sm text-zinc-700">
              {planSteps.map((step: PlanStep, index: number) => {
                const dateLabel = step.dateSuggestion ? new Date(step.dateSuggestion).toLocaleDateString() : null;
                const isDone = Boolean(step.done);
                return (
                  <li
                    key={index}
                    className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      {planRow ? (
                        <button
                          type="button"
                          onClick={() => handleTogglePlanStep(index)}
                          disabled={planUpdatingIndex === index || planSaving}
                          className={`flex h-6 w-6 items-center justify-center rounded-full border transition ${
                            isDone ? "border-emerald-500 bg-emerald-500 text-white" : "border-emerald-300 bg-white text-emerald-500"
                          }`}
                          aria-pressed={isDone}
                        >
                          <span className="text-xs font-semibold">{isDone ? "Done" : index + 1}</span>
                        </button>
                      ) : (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                          {index + 1}
                        </span>
                      )}
                      <span className="font-medium text-emerald-700">Session {index + 1}</span>
                    </div>
                    <div className="flex items-center gap-3 text-emerald-600">
                      <span>{step.minutes} min</span>
                      {dateLabel ? <span className="text-xs text-emerald-500">~ {dateLabel}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </section>
      ) : null}
      <nav
        className="rounded-2xl border border-zinc-200 bg-white p-1 shadow-sm"
        role="tablist"
        aria-label="Game detail sections"
      >
        <div className="flex flex-wrap gap-1">
          {TAB_CONFIG.map(({ key, label, description }) => {
            const selected = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                id={tabButtonId(key)}
                role="tab"
                aria-selected={selected}
                aria-controls={tabPanelId(key)}
                onClick={(event) => {
                  event.stopPropagation();
                  setTab(key);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className={clsx(
                  "flex-1 min-w-[6rem] rounded-xl px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                  selected ? "bg-emerald-600 text-white shadow-sm" : "text-zinc-600 hover:bg-emerald-50",
                )}
              >
                {label}
                <span className="sr-only">{description}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {activeTab === "media" ? (
        <section role="tabpanel" id={tabPanelId("media")} aria-labelledby={tabButtonId("media")}>
          <MediaTab backgroundImage={data.backgroundImage} screenshots={data.screenshots} movies={data.movies} />
        </section>
      ) : null}
      {activeTab === "overview" ? (
        <section role="tabpanel" id={tabPanelId("overview")} aria-labelledby={tabButtonId("overview")}>
          <OverviewTab data={data} />
        </section>
      ) : null}
      {activeTab === "stores" ? (
        <section role="tabpanel" id={tabPanelId("stores")} aria-labelledby={tabButtonId("stores")}>
          <StoresTab stores={data.stores} />
        </section>
      ) : null}
      {activeTab === "news" ? (
        <section role="tabpanel" id={tabPanelId("news")} aria-labelledby={tabButtonId("news")}>
          <NewsTab items={data.steamNews} />
        </section>
      ) : null}
      {activeTab === "achievements" ? (
        <section
          role="tabpanel"
          id={tabPanelId("achievements")}
          aria-labelledby={tabButtonId("achievements")}
        >
          <AchievementsTab data={data.steamAchievements} appid={appid} />
        </section>
      ) : null}
    </div>
  );
}




















