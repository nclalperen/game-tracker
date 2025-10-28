import Dexie, { Table } from "dexie";
import type { Account, Identity, LibraryItem, Member } from "@tracker/core";

/**
 * Dexie database for the game tracker.
 *
 * Version history:
 *  - v1: base schema
 *  - v2: add `appid` and `igdbCoverId` to identities
 *  - v3: temporary `ttbSource` column on library rows
 *  - v4: move `ttbSource` onto identities
 *  - v5: add `currencyCode` to library rows
 */
export type RawgStoreInfo = {
  id: number;
  name: string;
  url?: string | null;
  domain?: string | null;
};

export type RawgScreenshot = {
  id: number;
  image: string;
  width?: number;
  height?: number;
  isVideo?: boolean;
  thumbnail?: string | null;
};

export type RawgMovie = {
  id: number;
  name: string;
  preview: string | null;
  data?: {
    "480"?: string;
    max?: string;
  };
};

export type RawgGameCache = {
  id: number;
  slug: string;
  title: string;
  titleKey: string;
  descriptionRaw?: string | null;
  backgroundImage?: string | null;
  backgroundImageAdditional?: string | null;
  genres: string[];
  tags?: string[];
  platforms?: string[];
  stores: RawgStoreInfo[];
  developers?: string[];
  publishers?: string[];
  esrb?: string | null;
  playtimeHours?: number | null;
  screenshotsCount?: number | null;
  metacriticScore?: number | null;
  rating?: number | null;
  ratingTop?: number | null;
  ratingsCount?: number | null;
  aggregatedScore?: number | null;
  rawgScore?: number | null;
  released?: string | null;
  updatedAtISO: string;
  mediaUpdatedAtISO?: string;
  screenshots?: RawgScreenshot[];
  movies?: RawgMovie[];
};

export type RawgExploreResult = {
  id: number;
  slug: string;
  name: string;
  backgroundImage?: string | null;
  rating?: number | null;
  metacritic?: number | null;
  released?: string | null;
  genres: string[];
  platforms: string[];
  stores: RawgStoreInfo[];
};

export type RawgExploreRow = {
  key: string;
  results: RawgExploreResult[];
  lastFetchedISO: string;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type SteamProfileRow = {
  steamid: string;
  personaname: string;
  avatarfull?: string | null;
  profileurl?: string | null;
  loccountrycode?: string | null;
  gameid?: string | null;
  gameextrainfo?: string | null;
  personastate?: number | null;
  communityvisibilitystate?: number | null;
  profilestate?: number | null;
  lastlogoff?: number | null;
  primaryclanid?: string | null;
  timecreated?: number | null;
  lastFetchedISO: string;
};

export type SteamOwnedRow = {
  steamid: string;
  appid: number;
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
  lastFetchedISO: string;
};

export type SteamAppRow = {
  appid: number;
  name: string;
  isFree: boolean;
  headerImage?: string | null;
  capsuleImage?: string | null;
  background?: string | null;
  shortDescription?: string | null;
  genres: string[];
  categories: string[];
  releaseDateISO?: string | null;
  controllerSupport?: string | null;
  pcReqMinimum?: string | null;
  pcReqRecommended?: string | null;
  lastFetchedISO: string;
};

export type SteamPriceRow = {
  appid: number;
  currency: string;
  initial: number;
  final: number;
  discountPercent: number;
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

export type SteamNewsRow = {
  appid: number;
  items: SteamNewsItem[];
  lastFetchedISO: string;
};

export type SteamAchievementItem = {
  apiName: string;
  achieved: boolean;
  unlockTime?: number | null;
};

export type SteamAchievementsRow = {
  steamid: string;
  appid: number;
  unlocked: number;
  total: number;
  items: SteamAchievementItem[];
  lastFetchedISO: string;
};

export type SteamSchemaEntry = {
  apiName: string;
  displayName: string;
  description?: string | null;
  icon?: string | null;
  iconGray?: string | null;
};

export type SteamSchemaRow = {
  appid: number;
  items: SteamSchemaEntry[];
  lastFetchedISO: string;
};

export type SteamPlayerCountRow = {
  appid: number;
  playerCount: number | null;
  lastFetchedISO: string;
};

export type SteamRecentRow = {
  steamid: string;
  appid: number;
  name: string;
  playtimeTwoWeeksMin?: number | null;
  playtimeForeverMin?: number | null;
  lastPlayedAt?: number | null;
  iconHash?: string | null;
  logoHash?: string | null;
  lastFetchedISO: string;
};

export type SessionEntry = {
  id: string;
  exe: string;
  identityId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
};

const STEAM_PROFILE_TTL_MS = 24 * HOUR_MS;
const STEAM_OWNED_TTL_MS = 24 * HOUR_MS;
const STEAM_APP_TTL_MS = 30 * DAY_MS;
const STEAM_PRICE_TTL_MS = 3 * DAY_MS;
const STEAM_NEWS_TTL_MS = 6 * HOUR_MS;
const STEAM_ACH_TTL_MS = 24 * HOUR_MS;
const STEAM_SCHEMA_TTL_MS = 30 * DAY_MS;
const STEAM_PLAYERCOUNT_TTL_MS = 10 * 60 * 1000;
const STEAM_RECENT_TTL_MS = 6 * HOUR_MS;
const RAWG_EXPLORE_TTL_MS = 6 * HOUR_MS;
const SESSION_PRUNE_LIMIT = 400;

function isoAgeMs(iso?: string | null): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return Date.now() - ts;
}

function isIsoStale(iso: string | null | undefined, ttlMs: number): boolean {
  const age = isoAgeMs(iso ?? undefined);
  return age == null || age > ttlMs;
}

class GTDb extends Dexie {
  identities!: Table<Identity, string>;
  accounts!: Table<Account, string>;
  members!: Table<Member, string>;
  library!: Table<LibraryItem, string>;
  settings!: Table<{ key: string; value: unknown }, string>;
  rawgGames!: Table<RawgGameCache, number>;
  rawgExplore!: Table<RawgExploreRow, string>;
  steamProfiles!: Table<SteamProfileRow, string>;
  steamOwned!: Table<SteamOwnedRow, [string, number]>;
  steamApps!: Table<SteamAppRow, number>;
  steamPrices!: Table<SteamPriceRow, number>;
  steamNews!: Table<SteamNewsRow, number>;
  steamAchievements!: Table<SteamAchievementsRow, [string, number]>;
  steamRecent!: Table<SteamRecentRow, [string, number]>;
  steamSchemas!: Table<SteamSchemaRow, number>;
  sessions!: Table<SessionEntry, string>;
  steamPlayerCounts!: Table<SteamPlayerCountRow, number>;

  constructor() {
    super("game-tracker");

    // ---------- v1: base schema ----------
    this.version(1).stores({
      identities: "id, title, platform",
      accounts: "id, label, platform",
      members: "id, name",
      library: "id, identityId, accountId, memberId, status, acquiredAt",
    });

    // ---------- v2: add appid & igdbCoverId to identities ----------
    this.version(2)
      .stores({
        identities: "id, title, platform, appid, igdbCoverId, ttbMedianMainH",
        accounts: "id, label, platform",
        members: "id, name",
        library: "id, identityId, accountId, memberId, status, acquiredAt",
      })
      .upgrade(async (tx) => {
        const table = tx.table("identities");
        await table.toCollection().modify((row: any) => {
          if (typeof row.appid === "undefined") row.appid = undefined;
          if (typeof row.igdbCoverId === "undefined") row.igdbCoverId = undefined;
          if (typeof row.ttbMedianMainH === "undefined") row.ttbMedianMainH = undefined;
        });
      });

    // ---------- v3: introduce ttbSource on library ----------
    this.version(3)
      .stores({
        identities: "id, title, platform, appid, igdbCoverId, ttbMedianMainH",
        accounts: "id, label, platform",
        members: "id, name",
        library: "id, identityId, accountId, memberId, status, acquiredAt, ttbSource",
      })
      .upgrade(async (tx) => {
        const table = tx.table("library");
        await table.toCollection().modify((row: any) => {
          if (typeof row.ttbSource === "undefined") row.ttbSource = undefined;
        });
      });

    // ---------- v4: move ttbSource to identities ----------
    this.version(4)
      .stores({
        identities: "id, title, platform, appid, igdbCoverId, ttbSource, ttbMedianMainH",
        accounts: "id, label, platform",
        members: "id, name",
        library: "id, identityId, accountId, memberId, status, acquiredAt",
      })
      .upgrade(async (tx) => {
        const libTable = tx.table("library");
        const identTable = tx.table("identities");

        await libTable.toCollection().each(async (row: any) => {
          if (row.ttbSource) {
            const identityId = row.identityId;
            const identity = await identTable.get(identityId);
            if (identity) {
              await identTable.update(identityId, { ttbSource: row.ttbSource });
            }
          }
        });

        await libTable.toCollection().modify((row: any) => {
          if ("ttbSource" in row) delete (row as any).ttbSource;
        });
      });

    // ---------- v5: add currencyCode and ttbMedianMainH ----------
    this.version(5)
      .stores({
        identities: "id, title, platform, appid, igdbCoverId, ttbSource, ttbMedianMainH",
        accounts: "id, label, platform",
        members: "id, name",
        library: "id, identityId, accountId, memberId, status, acquiredAt, currencyCode",
      })
      .upgrade(async (tx) => {
        const libTable = tx.table("library");
        const identTable = tx.table("identities");
        await libTable.toCollection().modify((row: any) => {
          if (typeof row.currencyCode === "undefined") {
            if (typeof row.priceCurrency === "string") {
              row.currencyCode = row.priceCurrency;
            } else {
              row.currencyCode = undefined;
            }
          }
          if ("priceCurrency" in row) {
            delete (row as any).priceCurrency;
          }
        });

        await libTable.toCollection().each(async (row: any) => {
          if (row.ttbMedianMainH != null) {
            await identTable.update(row.identityId, {
              ttbMedianMainH: row.ttbMedianMainH,
            });
          }
        });
      });

    // ---------- v6: introduce settings key/value store ----------
    this.version(6).stores({
      identities: "id, title, platform, appid, igdbCoverId, ttbSource, ttbMedianMainH",
      accounts: "id, label, platform",
      members: "id, name",
      library: "id, identityId, accountId, memberId, status, acquiredAt, currencyCode",
      settings: "key",
    });

    // ---------- v7: add Metacritic fields ----------
    this.version(7).stores({
      identities: "id, title, platform, appid, igdbCoverId, ttbSource, ttbMedianMainH, mcScore, mcUserScore, mcGenres",
      accounts: "id, label, platform",
      members: "id, name",
      library: "id, identityId, accountId, memberId, status, acquiredAt, currencyCode",
      settings: "key",
    }).upgrade(async (tx) => {
      const identTable = tx.table("identities");
      await identTable.toCollection().modify((row: any) => {
        if (typeof row.mcScore === "undefined") row.mcScore = undefined;
        if (typeof row.mcUserScore === "undefined") row.mcUserScore = undefined;
        if (typeof row.mcGenres === "undefined") row.mcGenres = undefined;
      });
    });

    // ---------- v8: add RAWG cache ----------
    this.version(8).stores({
      identities: "id, title, platform, appid, igdbCoverId, ttbSource, ttbMedianMainH, mcScore, mcUserScore, mcGenres",
      accounts: "id, label, platform",
      members: "id, name",
      library: "id, identityId, accountId, memberId, status, acquiredAt, currencyCode",
      settings: "key",
      rawgGames: "id, slug, titleKey",
    });

    this.version(9)
      .stores({
        identities:
          "id, title, platform, appid, igdbCoverId, ttbSource, ttbMedianMainH, mcScore, mcUserScore, mcGenres, rawgId, rawgSlug",
        accounts: "id, label, platform",
        members: "id, name",
        library: "id, identityId, accountId, memberId, status, acquiredAt, currencyCode",
        settings: "key",
        rawgGames: "id, slug, titleKey",
      })
      .upgrade(async (tx) => {
        const identitiesTable = tx.table("identities");
        await identitiesTable.toCollection().modify((row: any) => {
          if (typeof row.rawgId === "undefined") row.rawgId = undefined;
          if (typeof row.rawgSlug === "undefined") row.rawgSlug = undefined;
        });
        const rawgTable = tx.table("rawgGames");
        await rawgTable.toCollection().modify((row: any) => {
          if (!Array.isArray(row.genres)) row.genres = Array.isArray(row.genres) ? row.genres : [];
        });
      });

    this.version(10).stores({
      identities:
        "id, title, platform, appid, igdbCoverId, ttbSource, ttbMedianMainH, mcScore, mcUserScore, mcGenres, rawgId, rawgSlug",
      accounts: "id, label, platform",
      members: "id, name",
      library: "id, identityId, accountId, memberId, status, acquiredAt, currencyCode",
      settings: "key",
      rawgGames: "id, slug, titleKey",
      steamProfiles: "steamid",
      steamOwned: "[steamid+appid], steamid",
      steamApps: "appid",
      steamPrices: "appid",
      steamNews: "appid",
      steamAchievements: "[steamid+appid], steamid",
      steamSchemas: "appid",
    });

    this.version(11).stores({
      identities:
        "id, title, platform, appid, igdbCoverId, ttbSource, ttbMedianMainH, mcScore, mcUserScore, mcGenres, rawgId, rawgSlug",
      accounts: "id, label, platform",
      members: "id, name",
      library: "id, identityId, accountId, memberId, status, acquiredAt, currencyCode",
      settings: "key",
      rawgGames: "id, slug, titleKey",
      steamProfiles: "steamid",
      steamOwned: "[steamid+appid], steamid",
      steamApps: "appid",
      steamPrices: "appid",
      steamNews: "appid",
      steamAchievements: "[steamid+appid], steamid",
      steamSchemas: "appid",
      sessions: "id, startedAt, endedAt, identityId",
    });

    this.version(12).stores({
      identities:
        "id, title, platform, appid, igdbCoverId, ttbSource, ttbMedianMainH, mcScore, mcUserScore, mcGenres, rawgId, rawgSlug",
      accounts: "id, label, platform",
      members: "id, name",
      library: "id, identityId, accountId, memberId, status, acquiredAt, currencyCode",
      settings: "key",
      rawgGames: "id, slug, titleKey",
      steamProfiles: "steamid",
      steamOwned: "[steamid+appid], steamid",
      steamApps: "appid",
      steamPrices: "appid",
      steamNews: "appid",
      steamAchievements: "[steamid+appid], steamid",
      steamSchemas: "appid",
      steamRecent: "[steamid+appid], steamid",
      sessions: "id, startedAt, endedAt, identityId",
      steamPlayerCounts: "appid",
    });

    this.version(13).stores({
      identities:
        "id, title, platform, appid, igdbCoverId, ttbSource, ttbMedianMainH, mcScore, mcUserScore, mcGenres, rawgId, rawgSlug",
      accounts: "id, label, platform",
      members: "id, name",
      library: "id, identityId, accountId, memberId, status, acquiredAt, currencyCode",
      settings: "key",
      rawgGames: "id, slug, titleKey",
      steamProfiles: "steamid",
      steamOwned: "[steamid+appid], steamid",
      steamApps: "appid",
      steamPrices: "appid",
      steamNews: "appid",
      steamAchievements: "[steamid+appid], steamid",
      steamSchemas: "appid",
      steamRecent: "[steamid+appid], steamid",
      sessions: "id, startedAt, endedAt, identityId",
      steamPlayerCounts: "appid",
    });

    this.version(14).stores({
      identities:
        "id, title, platform, appid, igdbCoverId, ttbSource, ttbMedianMainH, mcScore, mcUserScore, mcGenres, rawgId, rawgSlug",
      accounts: "id, label, platform",
      members: "id, name",
      library: "id, identityId, accountId, memberId, status, acquiredAt, currencyCode",
      settings: "key",
      rawgGames: "id, slug, titleKey",
      rawgExplore: "key",
      steamProfiles: "steamid",
      steamOwned: "[steamid+appid], steamid",
      steamApps: "appid",
      steamPrices: "appid",
      steamNews: "appid",
      steamAchievements: "[steamid+appid], steamid",
      steamSchemas: "appid",
      steamRecent: "[steamid+appid], steamid",
      sessions: "id, startedAt, endedAt, identityId",
      steamPlayerCounts: "appid",
    });

    this.identities = this.table("identities");
    this.accounts = this.table("accounts");
    this.members = this.table("members");
    this.library = this.table("library");
    this.settings = this.table("settings");
    this.rawgGames = this.table("rawgGames");
    this.rawgExplore = this.table("rawgExplore");
    this.steamProfiles = this.table("steamProfiles");
    this.steamOwned = this.table("steamOwned");
    this.steamApps = this.table("steamApps");
    this.steamPrices = this.table("steamPrices");
    this.steamNews = this.table("steamNews");
    this.steamAchievements = this.table("steamAchievements");
    this.steamSchemas = this.table("steamSchemas");
    this.steamRecent = this.table("steamRecent");
    this.sessions = this.table("sessions");
    this.steamPlayerCounts = this.table("steamPlayerCounts");
  }
}

export const db = new GTDb();

export type EnrichStatus =
  | "pending"
  | "fetching"
  | "paused"
  | "done"
  | "skipped"
  | "error";

export type EnrichRowSnapshot = {
  id: string;
  identityId: string;
  title: string;
  appid?: number | null;
  status: EnrichStatus;
  updatedAt: number;
  price?: number | null;
  currencyCode?: string | null;
  ttb?: number | null;
  ttbSource?: Identity["ttbSource"];
  ocScore?: number | null;
  mcScore?: number | null;
  criticScoreSource?: Identity["criticScoreSource"];
  message?: string | null;
  stage?: "vendor" | "fallback";
};

export type EnrichRowSummary = {
  id: string;
  title: string;
  finishedAt: number;
  price?: number | null;
  currencyCode?: string | null;
  ttb?: number | null;
  ttbSource?: Identity["ttbSource"];
  ocScore?: number | null;
  mcScore?: number | null;
  criticScoreSource?: Identity["criticScoreSource"];
};

export type EnrichSession = {
  sessionId: string;
  startedAt: number;
  lastUpdated: number;
  paused: boolean;
  totalRows: number;
  completedCount: number;
  region?: string;
  queue: EnrichRowSnapshot[];
  recent: EnrichRowSummary[];
  phase?: "idle" | "init" | "active" | "paused" | "done";
  halted?: boolean;
};
export function isRawgGameStale(game: RawgGameCache, maxAgeDays = 30): boolean {
  const updated = Date.parse(game.updatedAtISO);
  if (!Number.isFinite(updated)) return true;
  const ageMs = Date.now() - updated;
  const maxMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return ageMs > maxMs;
}

export function isRawgMediaStale(game: RawgGameCache, maxAgeDays = 7): boolean {
  if (!game.mediaUpdatedAtISO) return true;
  const updated = Date.parse(game.mediaUpdatedAtISO);
  if (!Number.isFinite(updated)) return true;
  const ageMs = Date.now() - updated;
  const maxMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return ageMs > maxMs;
}

export async function getRawgGame(id: number): Promise<RawgGameCache | undefined> {
  return db.rawgGames.get(id);
}

export async function getRawgGameByTitleKey(titleKey: string): Promise<RawgGameCache | undefined> {
  return db.rawgGames.where("titleKey").equals(titleKey).first();
}

export async function clearRawgCache(): Promise<{ games: number; explore: number }> {
  const [games, explore] = await Promise.all([db.rawgGames.count(), db.rawgExplore.count()]);
  await db.transaction("rw", db.rawgGames, db.rawgExplore, async () => {
    await db.rawgGames.clear();
    await db.rawgExplore.clear();
  });
  return { games, explore };
}

export async function upsertRawgGame(game: RawgGameCache): Promise<void> {
  const existing = await db.rawgGames.get(game.id);
  const merged: RawgGameCache = existing
    ? {
        ...existing,
        ...game,
        genres: game.genres ?? existing.genres ?? [],
        tags: game.tags ?? existing.tags,
        platforms: game.platforms ?? existing.platforms,
        stores: game.stores ?? existing.stores ?? [],
        developers: game.developers ?? existing.developers,
        publishers: game.publishers ?? existing.publishers,
        screenshots: game.screenshots ?? existing.screenshots,
        movies: game.movies ?? existing.movies,
        updatedAtISO: game.updatedAtISO || existing.updatedAtISO,
        mediaUpdatedAtISO: game.mediaUpdatedAtISO || existing.mediaUpdatedAtISO,
      }
    : {
        ...game,
        genres: game.genres ?? [],
        stores: game.stores ?? [],
        updatedAtISO: game.updatedAtISO || new Date().toISOString(),
      };

  if (merged.genres) {
    merged.genres = [...new Set(merged.genres)];
  }
  if (merged.tags) {
    merged.tags = [...new Set(merged.tags)];
  }
  if (merged.platforms) {
    merged.platforms = [...new Set(merged.platforms)];
  }
  await db.rawgGames.put(merged);
}
/** Clear all app data (used by the "Clear Profile" button). */
export async function clearAllData() {
  await db.transaction(
    "rw",
    [
      db.members,
      db.accounts,
      db.identities,
      db.library,
      db.settings,
      db.rawgGames,
      db.steamProfiles,
      db.steamOwned,
      db.steamApps,
      db.steamPrices,
      db.steamNews,
      db.steamAchievements,
      db.steamRecent,
      db.steamSchemas,
      db.steamPlayerCounts,
      db.sessions,
    ],
    async () => {
      await db.members.clear();
      await db.accounts.clear();
      await db.identities.clear();
      await db.library.clear();
      await db.settings.clear();
      await db.rawgGames.clear();
      await db.steamProfiles.clear();
      await db.steamOwned.clear();
      await db.steamApps.clear();
      await db.steamPrices.clear();
      await db.steamNews.clear();
      await db.steamAchievements.clear();
      await db.steamRecent.clear();
      await db.steamSchemas.clear();
      await db.steamPlayerCounts.clear();
      await db.sessions.clear();
    },
  );
}

/** Run a safe RW transaction across all tables. */
export async function withRW<T>(fn: () => Promise<T>) {
  return db.transaction(
    "rw",
    [
      db.members,
      db.accounts,
      db.identities,
      db.library,
      db.settings,
      db.rawgGames,
      db.steamProfiles,
      db.steamOwned,
      db.steamApps,
      db.steamPrices,
      db.steamNews,
      db.steamAchievements,
      db.steamRecent,
      db.steamSchemas,
      db.steamPlayerCounts,
      db.sessions,
    ],
    fn,
  );
}

const ENRICH_SESSION_KEY = "import_enrich_session";

export async function getEnrichSession(): Promise<EnrichSession | null> {
  const row = await db.settings.get(ENRICH_SESSION_KEY);
  if (!row) return null;
  return row.value as EnrichSession;
}

export async function setEnrichSession(session: EnrichSession) {
  await db.settings.put({ key: ENRICH_SESSION_KEY, value: session });
}

export async function clearEnrichSession() {
  await db.settings.delete(ENRICH_SESSION_KEY);
}

export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const row = await db.settings.get(key);
  if (!row) return undefined;
  return row.value as T;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.settings.delete(key);
}

function normalizeIso(value?: string | null): string {
  if (!value) return new Date().toISOString();
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return new Date().toISOString();
  return value;
}

function uniqStrings(items: (string | null | undefined)[] | undefined): string[] {
  if (!items) return [];
  const result: string[] = [];
  for (const item of items) {
    if (!item) continue;
    if (!result.includes(item)) result.push(item);
  }
  return result;
}

export async function getSteamProfileRow(steamid: string): Promise<SteamProfileRow | undefined> {
  return db.steamProfiles.get(steamid);
}

export async function upsertSteamProfileRow(profile: SteamProfileRow): Promise<void> {
  await db.steamProfiles.put({
    ...profile,
    lastFetchedISO: normalizeIso(profile.lastFetchedISO),
  });
}

export function isSteamProfileStale(profile: SteamProfileRow | undefined, ttlMs = STEAM_PROFILE_TTL_MS): boolean {
  if (!profile) return true;
  return isIsoStale(profile.lastFetchedISO, ttlMs);
}

export async function getSteamOwnedRows(steamid: string): Promise<SteamOwnedRow[]> {
  return db.steamOwned.where("steamid").equals(steamid).toArray();
}

export async function replaceSteamOwnedRows(steamid: string, rows: SteamOwnedRow[]): Promise<void> {
  const normalized = rows.map((row) => ({
    ...row,
    steamid,
    contentDescriptorIds: Array.isArray(row.contentDescriptorIds) ? [...row.contentDescriptorIds] : null,
    lastFetchedISO: normalizeIso(row.lastFetchedISO),
  }));
  await db.transaction("rw", db.steamOwned, async () => {
    await db.steamOwned.where("steamid").equals(steamid).delete();
    if (normalized.length) {
      await db.steamOwned.bulkPut(normalized);
    }
  });
}

export function isSteamOwnedStale(rows: SteamOwnedRow[], ttlMs = STEAM_OWNED_TTL_MS): boolean {
  if (!rows.length) return true;
  let youngestAge: number | null = null;
  for (const row of rows) {
    const age = isoAgeMs(row.lastFetchedISO);
    if (age == null) return true;
    youngestAge = youngestAge == null ? age : Math.min(youngestAge, age);
  }
  return youngestAge == null || youngestAge > ttlMs;
}

export async function getSteamAppRow(appid: number): Promise<SteamAppRow | undefined> {
  return db.steamApps.get(appid);
}

export async function upsertSteamAppRow(app: SteamAppRow): Promise<void> {
  const existing = await db.steamApps.get(app.appid);
  const merged: SteamAppRow = existing
    ? {
        ...existing,
        ...app,
        genres: uniqStrings([...(existing.genres ?? []), ...(app.genres ?? [])]),
        categories: uniqStrings([...(existing.categories ?? []), ...(app.categories ?? [])]),
        pcReqMinimum: app.pcReqMinimum ?? existing.pcReqMinimum ?? null,
        pcReqRecommended: app.pcReqRecommended ?? existing.pcReqRecommended ?? null,
        lastFetchedISO: normalizeIso(app.lastFetchedISO ?? existing.lastFetchedISO),
      }
    : {
        ...app,
        genres: uniqStrings(app.genres),
        categories: uniqStrings(app.categories),
        lastFetchedISO: normalizeIso(app.lastFetchedISO),
      };
  await db.steamApps.put(merged);
}

export function isSteamAppStale(app: SteamAppRow | undefined, ttlMs = STEAM_APP_TTL_MS): boolean {
  if (!app) return true;
  return isIsoStale(app.lastFetchedISO, ttlMs);
}

export async function getSteamPriceRow(appid: number): Promise<SteamPriceRow | undefined> {
  return db.steamPrices.get(appid);
}

export async function upsertSteamPriceRow(price: SteamPriceRow): Promise<void> {
  await db.steamPrices.put({
    ...price,
    lastFetchedISO: normalizeIso(price.lastFetchedISO),
  });
}

export function isSteamPriceStale(price: SteamPriceRow | undefined, ttlMs = STEAM_PRICE_TTL_MS): boolean {
  if (!price) return true;
  return isIsoStale(price.lastFetchedISO, ttlMs);
}

export async function getSteamNewsRow(appid: number): Promise<SteamNewsRow | undefined> {
  return db.steamNews.get(appid);
}

export async function upsertSteamNewsRow(row: SteamNewsRow): Promise<void> {
  await db.steamNews.put({
    ...row,
    items: row.items ?? [],
    lastFetchedISO: normalizeIso(row.lastFetchedISO),
  });
}

export function isSteamNewsStale(row: SteamNewsRow | undefined, ttlMs = STEAM_NEWS_TTL_MS): boolean {
  if (!row) return true;
  return isIsoStale(row.lastFetchedISO, ttlMs);
}

export async function getSteamAchievementsRow(
  steamid: string,
  appid: number,
): Promise<SteamAchievementsRow | undefined> {
  return db.steamAchievements.get([steamid, appid]);
}

export async function upsertSteamAchievementsRow(row: SteamAchievementsRow): Promise<void> {
  await db.steamAchievements.put({
    ...row,
    items: row.items ?? [],
    lastFetchedISO: normalizeIso(row.lastFetchedISO),
  });
}

export function isSteamAchievementsStale(
  row: SteamAchievementsRow | undefined,
  ttlMs = STEAM_ACH_TTL_MS,
): boolean {
  if (!row) return true;
  return isIsoStale(row.lastFetchedISO, ttlMs);
}

export async function getSteamSchemaRow(appid: number): Promise<SteamSchemaRow | undefined> {
  return db.steamSchemas.get(appid);
}

export async function upsertSteamSchemaRow(row: SteamSchemaRow): Promise<void> {
  await db.steamSchemas.put({
    ...row,
    items: row.items ?? [],
    lastFetchedISO: normalizeIso(row.lastFetchedISO),
  });
}

export function isSteamSchemaStale(schema: SteamSchemaRow | undefined, ttlMs = STEAM_SCHEMA_TTL_MS): boolean {
  if (!schema) return true;
  return isIsoStale(schema.lastFetchedISO, ttlMs);
}

export async function getSteamPlayerCountRow(appid: number): Promise<SteamPlayerCountRow | undefined> {
  return db.steamPlayerCounts.get(appid);
}

export async function upsertSteamPlayerCountRow(row: SteamPlayerCountRow): Promise<void> {
  await db.steamPlayerCounts.put({
    ...row,
    lastFetchedISO: normalizeIso(row.lastFetchedISO),
  });
}

export function isSteamPlayerCountStale(
  row: SteamPlayerCountRow | undefined,
  ttlMs = STEAM_PLAYERCOUNT_TTL_MS,
): boolean {
  if (!row) return true;
  return isIsoStale(row.lastFetchedISO, ttlMs);
}

export async function replaceSteamRecentRows(steamid: string, rows: SteamRecentRow[]): Promise<void> {
  const normalized = rows.map((row) => ({
    ...row,
    steamid,
    lastFetchedISO: normalizeIso(row.lastFetchedISO),
  }));
  await db.transaction("rw", db.steamRecent, async () => {
    await db.steamRecent.where("steamid").equals(steamid).delete();
    if (normalized.length) {
      await db.steamRecent.bulkPut(normalized);
    }
  });
}

export async function getSteamRecentRows(steamid: string): Promise<SteamRecentRow[]> {
  return db.steamRecent.where("steamid").equals(steamid).toArray();
}

export function isSteamRecentStale(row: SteamRecentRow | undefined, ttlMs = STEAM_RECENT_TTL_MS): boolean {
  if (!row) return true;
  return isIsoStale(row.lastFetchedISO, ttlMs);
}

export async function getRawgExploreRow(key: string): Promise<RawgExploreRow | undefined> {
  return db.rawgExplore.get(key);
}

export async function upsertRawgExploreRow(row: RawgExploreRow): Promise<void> {
  await db.rawgExplore.put({
    ...row,
    lastFetchedISO: normalizeIso(row.lastFetchedISO),
  });
}

export function isRawgExploreStale(row: RawgExploreRow | undefined, ttlMs = RAWG_EXPLORE_TTL_MS): boolean {
  if (!row) return true;
  return isIsoStale(row.lastFetchedISO, ttlMs);
}

const REONBOARDING_SNOOZE_KEY = "ui.reonboardingSnooze";
const LIBRARY_SORT_KEY = "library.sortState";

function normalizeSession(entry: SessionEntry): SessionEntry {
  return {
    id: entry.id,
    exe: entry.exe,
    identityId: entry.identityId ?? null,
    startedAt: normalizeIso(entry.startedAt),
    endedAt: entry.endedAt ? normalizeIso(entry.endedAt) : null,
    durationMs: entry.durationMs ?? null,
  };
}

export async function addSessionEntry(entry: SessionEntry): Promise<void> {
  const normalized = normalizeSession(entry);
  await db.sessions.put(normalized);

  const count = await db.sessions.count();
  if (count > SESSION_PRUNE_LIMIT) {
    const overflow = count - SESSION_PRUNE_LIMIT;
    if (overflow > 0) {
      const keys = await db.sessions.orderBy("startedAt").limit(overflow).primaryKeys();
      if (keys.length) {
        await db.sessions.bulkDelete(keys as string[]);
      }
    }
  }
}

export async function updateSessionEntry(id: string, updates: Partial<SessionEntry>): Promise<void> {
  const payload: Partial<SessionEntry> = {};
  if (typeof updates.exe === "string") payload.exe = updates.exe;
  if ("identityId" in updates) payload.identityId = updates.identityId ?? null;
  if (updates.startedAt) payload.startedAt = normalizeIso(updates.startedAt);
  if ("endedAt" in updates) payload.endedAt = updates.endedAt ? normalizeIso(updates.endedAt) : null;
  if ("durationMs" in updates) payload.durationMs = updates.durationMs ?? null;

  if (Object.keys(payload).length === 0) return;
  await db.sessions.update(id, payload);
}

export async function recentSessions(limit = 20): Promise<SessionEntry[]> {
  const count = Math.max(1, Math.min(limit, SESSION_PRUNE_LIMIT));
  return db.sessions.orderBy("startedAt").reverse().limit(count).toArray();
}

export async function getReonboardingSnooze(): Promise<string | null> {
  const snooze = await getSetting<string | null>(REONBOARDING_SNOOZE_KEY);
  return snooze ?? null;
}

export async function setReonboardingSnooze(untilIso: string | null): Promise<void> {
  if (!untilIso) {
    await deleteSetting(REONBOARDING_SNOOZE_KEY);
    return;
  }
  await setSetting(REONBOARDING_SNOOZE_KEY, normalizeIso(untilIso));
}

export type LibrarySortState = { field: string; direction: "asc" | "desc" };

export async function getLibrarySort(): Promise<LibrarySortState | null> {
  const value = await getSetting<LibrarySortState | null>(LIBRARY_SORT_KEY);
  if (!value) return null;
  if (typeof value.field !== "string") return null;
  if (value.direction !== "asc" && value.direction !== "desc") return null;
  return value;
}

export async function setLibrarySort(sort: LibrarySortState): Promise<void> {
  await setSetting(LIBRARY_SORT_KEY, sort);
}
