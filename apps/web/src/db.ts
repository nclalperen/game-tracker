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

export type RawgListItem = {
  id: number;
  slug: string;
  title: string;
  backgroundImage?: string | null;
  rating?: number | null;
  metacritic?: number | null;
  released?: string | null;
  genres: string[];
  platforms: string[];
  stores: RawgStoreInfo[];
};

export type RawgListRow = {
  key: string;
  page: number;
  items: RawgListItem[];
  fetchedAtISO: string;
};

export type WishlistItem = {
  id?: number;
  appid: number;
  title: string;
  addedAtISO: string | null;
  priority: number | null;
  notes: string | null;
  source: string;
  platform: string | null;
  currency: string | null;
  initial: number | null;
  final: number | null;
  discountPercent: number | null;
  saleEndISO: string | null;
  lastFetchedISO: string;
};

export type DealView = {
  appid: number;
  title: string;
  inLibrary: boolean;
  installed: boolean;
  identityId: string | null;
  currency: string | null;
  criticScore: number | null;
  ttbMainH: number | null;
  priceFinal: number | null;
  priceInitial: number | null;
  discountPercent: number | null;
  saleEndISO: string | null;
  valuePerHour: number | null;
  dealScore: number;
  wishlist: boolean;
};

export type AllyAutomationSettings = {
  enabled: boolean;
  exportEmbedStartTime: string;
  lastExportISO: string | null;
  lastEmbedISO: string | null;
  lastStartISO: string | null;
  digestEnabled: boolean;
  digestTime: string;
  digestScope: "coach" | "deals" | "both";
  digestAllowWeb: boolean;
  lastDigestISO: string | null;
  lastDigestStatus: "ok" | "error" | null;
};

export type AllyDigest = {
  id?: number;
  content: string;
  status: "ok" | "error";
  createdAtISO: string;
};

export type AllyLogRow = {
  id?: number;
  atISO: string;
  level: "info" | "warn" | "error";
  msg: string;
  ctx?: unknown;
};

export type AllyTranscript = {
  id?: number;
  atISO: string;
  session: string | null;
  mode: "coach" | "deals" | "qa" | string;
  allowWeb: boolean;
  query: string;
  reply: unknown;
};

export type PlanStep = {
  minutes: number;
  done: boolean;
  dateSuggestion?: string | null;
};

export type PlanRow = {
  id?: number;
  identityId: string;
  createdAtISO: string;
  updatedAtISO: string;
  doneCount: number;
  steps: PlanStep[];
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
  rawgLists!: Table<RawgListRow, string>;
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
  wishlists!: Table<WishlistItem, number>;
  allyDigests!: Table<AllyDigest, number>;
  allyLogs!: Table<AllyLogRow, number>;
  allyTranscripts!: Table<AllyTranscript, number>;
  plans!: Table<PlanRow, number>;

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

    this.version(15)
      .stores({
        identities:
          "id, title, platform, appid, igdbCoverId, ttbSource, ttbMedianMainH, mcScore, mcUserScore, mcGenres, rawgId, rawgSlug",
        accounts: "id, label, platform",
        members: "id, name",
        library: "id, identityId, accountId, memberId, status, acquiredAt, currencyCode",
        settings: "key",
        rawgGames: "id, slug, titleKey",
        rawgExplore: null,
        rawgLists: "key",
        steamProfiles: "steamid",
        steamOwned: "[steamid+appid], steamid",
        steamApps: "appid",
        steamPrices: "appid, [appid+lastFetchedISO]",
        steamNews: "appid",
        steamAchievements: "[steamid+appid], steamid",
        steamSchemas: "appid",
        steamRecent: "[steamid+appid], steamid",
        sessions: "id, startedAt, endedAt, identityId, [identityId+startedAt]",
        steamPlayerCounts: "appid",
        wishlists: "++id,[source+appid],appid",
        allyDigests: "++id,createdAtISO",
        allyLogs: "++id,atISO",
        allyTranscripts: "++id,atISO",
        plans: "++id,identityId,createdAtISO",
      })
      .upgrade(async (tx) => {
        try {
          const legacy = tx.table("rawgExplore");
          const rows = await legacy.toArray();
          if (rows.length) {
            const lists = tx.table("rawgLists");
            const now = new Date().toISOString();
            await lists.bulkPut(
              rows.map((row: any) => ({
                key: row.key,
                page: typeof row.page === "number" ? row.page : 1,
                items: Array.isArray(row.results)
                  ? row.results.map((item: any) => ({
                      id: item?.id ?? 0,
                      slug: item?.slug ?? "",
                      title: item?.name ?? item?.slug ?? "Untitled",
                      backgroundImage: item?.backgroundImage ?? item?.background_image ?? null,
                      rating: typeof item?.rating === "number" ? item.rating : null,
                      metacritic: typeof item?.metacritic === "number" ? item.metacritic : null,
                      released: item?.released ?? null,
                      genres: Array.isArray(item?.genres)
                        ? item.genres.map((genre: any) => genre?.name).filter(Boolean)
                        : [],
                      platforms: Array.isArray(item?.platforms)
                        ? item.platforms
                            .map((platform: any) => platform?.platform?.name ?? platform?.name)
                            .filter(Boolean)
                        : [],
                      stores: Array.isArray(item?.stores)
                        ? item.stores
                            .map((store: any) => ({
                              id: store?.store?.id ?? store?.id ?? 0,
                              name: store?.store?.name ?? store?.name ?? "",
                              url: store?.store?.domain ?? null,
                              domain: store?.store?.domain ?? null,
                            }))
                            .filter((store: any) => store.name)
                        : [],
                    }))
                  : [],
                fetchedAtISO: row.lastFetchedISO ?? now,
              })),
            );
          }
        } catch {
          // ignore legacy migration issues; explore cache is derivable
        }
      });

    this.identities = this.table("identities");
    this.accounts = this.table("accounts");
    this.members = this.table("members");
    this.library = this.table("library");
    this.settings = this.table("settings");
    this.rawgGames = this.table("rawgGames");
    this.rawgLists = this.table("rawgLists");
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
    this.wishlists = this.table("wishlists");
    this.allyDigests = this.table("allyDigests");
    this.allyLogs = this.table("allyLogs");
    this.allyTranscripts = this.table("allyTranscripts");
    this.plans = this.table("plans");
  }
}

export const db = new GTDb();

const PERF_LOG_THRESHOLD_MS = 20;
let perfLogEnabled = false;

const perfNow = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

function logDurationIfNeeded(operation: string, tableName: string, start: number) {
  const duration = perfNow() - start;
  if (perfLogEnabled && duration >= PERF_LOG_THRESHOLD_MS) {
    console.debug("[Dexie][" + tableName + "] " + operation, duration.toFixed(1) + "ms");
  }
}

db.use({
  stack: "dbcore",
  create(down) {
    return {
      table(tableName) {
        const table = down.table(tableName);
        return {
          ...table,
          query(req) {
            const start = perfNow();
            return table.query(req).then(
              (res) => {
                logDurationIfNeeded("query", tableName, start);
                return res;
              },
              (err) => {
                logDurationIfNeeded("query", tableName, start);
                throw err;
              },
            );
          },
          get(req) {
            const start = perfNow();
            return table.get(req).then(
              (res) => {
                logDurationIfNeeded("get", tableName, start);
                return res;
              },
              (err) => {
                logDurationIfNeeded("get", tableName, start);
                throw err;
              },
            );
          },
          mutate(req) {
            const start = perfNow();
            return table.mutate(req).then(
              (res) => {
                logDurationIfNeeded("mutate", tableName, start);
                return res;
              },
              (err) => {
                logDurationIfNeeded("mutate", tableName, start);
                throw err;
              },
            );
          },
        };
      },
    };
  },
});

export function isPerfLoggingEnabled(): boolean {
  return perfLogEnabled;
}

void (async () => {
  try {
    const row = await db.settings.get("dev.logPerf");
    perfLogEnabled = Boolean(row?.value);
  } catch {
    perfLogEnabled = false;
  }
})();

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

export async function clearRawgCache(): Promise<{ games: number; explore: number; lists: number }> {
  const [games, lists] = await Promise.all([db.rawgGames.count(), db.rawgLists.count()]);
  await db.transaction("rw", db.rawgGames, db.rawgLists, async () => {
    await db.rawgGames.clear();
    await db.rawgLists.clear();
  });
  return { games, explore: lists, lists };
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
  if (key === "dev.logPerf") {
    perfLogEnabled = Boolean(value);
  }
}

export async function deleteSetting(key: string): Promise<void> {
  await db.settings.delete(key);
  if (key === "dev.logPerf") {
    perfLogEnabled = false;
  }
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

export async function getRawgListRow(key: string): Promise<RawgListRow | undefined> {
  return db.rawgLists.get(key);
}

export async function upsertRawgListRow(row: RawgListRow): Promise<void> {
  await db.rawgLists.put({
    ...row,
    fetchedAtISO: normalizeIso(row.fetchedAtISO),
  });
}

export function isRawgListStale(row: RawgListRow | undefined, ttlMs = RAWG_EXPLORE_TTL_MS): boolean {
  if (!row) return true;
  return isIsoStale(row.fetchedAtISO, ttlMs);
}

export async function pruneRawgLists(maxAgeMs = 30 * DAY_MS): Promise<number> {
  const now = Date.now();
  const staleKeys: string[] = [];
  await db.rawgLists.each((row) => {
    const fetched = Date.parse(row.fetchedAtISO);
    if (!Number.isFinite(fetched)) {
      staleKeys.push(row.key);
      return;
    }
    if (now - fetched > maxAgeMs) {
      staleKeys.push(row.key);
    }
  });
  if (!staleKeys.length) return 0;
  await db.rawgLists.bulkDelete(staleKeys);
  return staleKeys.length;
}

export const WISHLIST_SOURCE_STEAM = "steam";
export const WISHLIST_SOURCE_USER = "user";
const WISHLIST_LIMIT = 2000;

function normalizeWishlistItem(item: WishlistItem): WishlistItem {
  return {
    ...item,
    title: item.title ?? `App ${item.appid}`,
    addedAtISO: item.addedAtISO ? normalizeIso(item.addedAtISO) : null,
    saleEndISO: item.saleEndISO ? normalizeIso(item.saleEndISO) : null,
    lastFetchedISO: normalizeIso(item.lastFetchedISO),
    source: item.source ?? WISHLIST_SOURCE_STEAM,
    platform: item.platform ?? null,
    currency: item.currency ?? null,
    priority: item.priority ?? null,
    notes: item.notes ?? null,
    initial: Number.isFinite(item.initial) ? item.initial : null,
    final: Number.isFinite(item.final) ? item.final : null,
    discountPercent: Number.isFinite(item.discountPercent) ? item.discountPercent : null,
  };
}

export async function upsertWishlist(items: WishlistItem[], source = WISHLIST_SOURCE_STEAM): Promise<void> {
  if (!Array.isArray(items) || items.length === 0) return;
  const normalized = items.slice(0, WISHLIST_LIMIT).map((item) =>
    normalizeWishlistItem({
      ...item,
      source: item.source ?? source,
    }),
  );
  await db.transaction("rw", db.wishlists, async () => {
    await db.wishlists.where("source").equals(source).delete();
    if (normalized.length) {
      await db.wishlists.bulkPut(normalized);
    }
  });
  notifyWishlistChanged();
}

function notifyWishlistChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("gt:wishlist-updated"));
  }
}

export async function getWishlistItems(): Promise<WishlistItem[]> {
  const rows = await db.wishlists.toArray();
  rows.sort((a, b) => {
    const aTime = a.addedAtISO ? Date.parse(a.addedAtISO) : 0;
    const bTime = b.addedAtISO ? Date.parse(b.addedAtISO) : 0;
    return bTime - aTime;
  });
  return rows;
}

export async function getWishlistItem(appid: number, source?: string): Promise<WishlistItem | undefined> {
  if (source) {
    return db.wishlists.where("[source+appid]").equals([source, appid]).first();
  }
  return db.wishlists.where("appid").equals(appid).first();
}

type WishlistDraft = {
  appid: number;
  title: string;
  addedAtISO?: string | null;
  priority?: number | null;
  notes?: string | null;
  platform?: string | null;
  currency?: string | null;
  initial?: number | null;
  final?: number | null;
  discountPercent?: number | null;
  saleEndISO?: string | null;
  source?: string;
};

export async function addWishlistItem(draft: WishlistDraft): Promise<number> {
  const source = draft.source ?? WISHLIST_SOURCE_USER;
  const now = new Date().toISOString();
  const existing = await db.wishlists.where("[source+appid]").equals([source, draft.appid]).first();
  const item: WishlistItem = normalizeWishlistItem({
    id: existing?.id,
    appid: draft.appid,
    title: draft.title,
    addedAtISO: existing?.addedAtISO ?? draft.addedAtISO ?? now,
    priority: draft.priority ?? existing?.priority ?? null,
    notes: draft.notes ?? existing?.notes ?? null,
    source,
    platform: draft.platform ?? existing?.platform ?? null,
    currency: draft.currency ?? existing?.currency ?? null,
    initial: draft.initial ?? existing?.initial ?? null,
    final: draft.final ?? existing?.final ?? null,
    discountPercent: draft.discountPercent ?? existing?.discountPercent ?? null,
    saleEndISO: draft.saleEndISO ?? existing?.saleEndISO ?? null,
    lastFetchedISO: now,
  });
  const id = await db.wishlists.put(item);
  notifyWishlistChanged();
  return id;
}

export async function removeWishlistItem(appid: number, source?: string): Promise<void> {
  if (source) {
    await db.wishlists.where("[source+appid]").equals([source, appid]).delete();
  } else {
    await db.wishlists.where("appid").equals(appid).delete();
  }
  notifyWishlistChanged();
}

export async function clearWishlist(source?: string): Promise<void> {
  if (source) {
    await db.wishlists.where("source").equals(source).delete();
  } else {
    await db.wishlists.clear();
  }
  notifyWishlistChanged();
}

export async function isAppWishlisted(appid: number): Promise<boolean> {
  const existing = await db.wishlists.where("appid").equals(appid).first();
  return Boolean(existing);
}

const AUTOMATION_SETTINGS_KEY = "ally.automation";
const AUTOMATION_DEFAULT: AllyAutomationSettings = {
  enabled: false,
  exportEmbedStartTime: "22:30",
  lastExportISO: null,
  lastEmbedISO: null,
  lastStartISO: null,
  digestEnabled: false,
  digestTime: "09:00",
  digestScope: "coach",
  digestAllowWeb: false,
  lastDigestISO: null,
  lastDigestStatus: null,
};

function mergeAutomationSettings(
  base: AllyAutomationSettings,
  patch: Partial<AllyAutomationSettings>,
): AllyAutomationSettings {
  return {
    ...base,
    ...patch,
    exportEmbedStartTime: patch.exportEmbedStartTime ?? base.exportEmbedStartTime ?? "22:30",
    digestTime: patch.digestTime ?? base.digestTime ?? "09:00",
    digestScope: patch.digestScope ?? base.digestScope ?? "coach",
    lastExportISO: patch.lastExportISO ?? base.lastExportISO ?? null,
    lastEmbedISO: patch.lastEmbedISO ?? base.lastEmbedISO ?? null,
    lastStartISO: patch.lastStartISO ?? base.lastStartISO ?? null,
    lastDigestISO: patch.lastDigestISO ?? base.lastDigestISO ?? null,
    lastDigestStatus: patch.lastDigestStatus ?? base.lastDigestStatus ?? null,
  };
}

export async function getAutomationSettings(): Promise<AllyAutomationSettings> {
  const stored = await getSetting<Partial<AllyAutomationSettings>>(AUTOMATION_SETTINGS_KEY);
  if (!stored) return { ...AUTOMATION_DEFAULT };
  return mergeAutomationSettings(AUTOMATION_DEFAULT, stored);
}

export async function saveAutomationSettings(
  patch: Partial<AllyAutomationSettings>,
): Promise<AllyAutomationSettings> {
  const current = await getAutomationSettings();
  const next = mergeAutomationSettings(current, patch);
  await setSetting(AUTOMATION_SETTINGS_KEY, next);
  return next;
}

const DIGEST_HISTORY_LIMIT = 50;

export async function addDigest(content: string, status: "ok" | "error"): Promise<AllyDigest> {
  const row: AllyDigest = {
    content,
    status,
    createdAtISO: new Date().toISOString(),
  };
  const id = await db.allyDigests.put(row);
  row.id = id;
  const count = await db.allyDigests.count();
  if (count > DIGEST_HISTORY_LIMIT) {
    const overflow = count - DIGEST_HISTORY_LIMIT;
    const keys = await db.allyDigests.orderBy("createdAtISO").limit(overflow).primaryKeys();
    if (keys.length) {
      await db.allyDigests.bulkDelete(keys as number[]);
    }
  }
  return row;
}

export async function getRecentDigests(limit = 20): Promise<AllyDigest[]> {
  const rows = await db.allyDigests.orderBy("createdAtISO").reverse().limit(limit).toArray();
  return rows;
}

const ALLY_LOG_LIMIT = 500;

export async function appendAllyLog(entry: Omit<AllyLogRow, "id" | "atISO">): Promise<void> {
  const row: AllyLogRow = {
    ...entry,
    atISO: new Date().toISOString(),
  };
  await db.allyLogs.add(row);
  const count = await db.allyLogs.count();
  if (count > ALLY_LOG_LIMIT) {
    const overflow = count - ALLY_LOG_LIMIT;
    const keys = await db.allyLogs.orderBy("atISO").limit(overflow).primaryKeys();
    if (keys.length) {
      await db.allyLogs.bulkDelete(keys as number[]);
    }
  }
}

export async function getRecentAllyLogs(limit = 200): Promise<AllyLogRow[]> {
  return db.allyLogs.orderBy("atISO").reverse().limit(limit).toArray();
}

export async function clearAllyLogs(): Promise<void> {
  await db.allyLogs.clear();
}

const TRANSCRIPT_LIMIT = 200;

export async function saveTranscript(entry: AllyTranscript): Promise<void> {
  const row: AllyTranscript = {
    ...entry,
    atISO: normalizeIso(entry.atISO),
  };
  await db.allyTranscripts.add(row);
  const count = await db.allyTranscripts.count();
  if (count > TRANSCRIPT_LIMIT) {
    const overflow = count - TRANSCRIPT_LIMIT;
    const keys = await db.allyTranscripts.orderBy("atISO").limit(overflow).primaryKeys();
    if (keys.length) {
      await db.allyTranscripts.bulkDelete(keys as number[]);
    }
  }
}

export async function getTranscripts(limit = 50): Promise<AllyTranscript[]> {
  return db.allyTranscripts.orderBy("atISO").reverse().limit(limit).toArray();
}

export async function clearTranscripts(): Promise<void> {
  await db.allyTranscripts.clear();
}

const SESSIONS_EXE_MAP_KEY = "sessions.exeMap";
const SESSIONS_ENABLED_KEY = "sessions.enabled";

export async function getSessionsExeMap(): Promise<Record<string, string | null> | null> {
  const value = await getSetting<Record<string, string | null> | null>(SESSIONS_EXE_MAP_KEY);
  if (!value || typeof value !== "object") return null;
  return value;
}

export async function setSessionsExeMap(map: Record<string, string | null>): Promise<void> {
  await setSetting(SESSIONS_EXE_MAP_KEY, map);
}

export async function getSessionsEnabledSetting(): Promise<boolean | null> {
  const value = await getSetting<boolean | null>(SESSIONS_ENABLED_KEY);
  if (typeof value !== "boolean") return null;
  return value;
}

export async function setSessionsEnabledSetting(enabled: boolean): Promise<void> {
  await setSetting(SESSIONS_ENABLED_KEY, Boolean(enabled));
}

const PLANS_PER_IDENTITY = 1;

function normalizePlanSteps(steps: PlanStep[]): PlanStep[] {
  return steps.map((step) => ({
    minutes: Math.max(1, Math.round(step.minutes)),
    done: Boolean(step.done),
    dateSuggestion: step.dateSuggestion ? normalizeIso(step.dateSuggestion) : null,
  }));
}

function computeDoneCount(steps: PlanStep[]): number {
  return steps.reduce((count, step) => (step.done ? count + 1 : count), 0);
}

export async function savePlan(identityId: string, steps: PlanStep[]): Promise<PlanRow> {
  const normalizedSteps = normalizePlanSteps(steps);
  const now = new Date().toISOString();
  const row: PlanRow = {
    identityId,
    createdAtISO: now,
    updatedAtISO: now,
    doneCount: computeDoneCount(normalizedSteps),
    steps: normalizedSteps,
  };
  await db.transaction("rw", db.plans, async () => {
    if (PLANS_PER_IDENTITY === 1) {
      await db.plans.where("identityId").equals(identityId).delete();
    }
    const id = await db.plans.add(row);
    row.id = id;
  });
  return row;
}

export async function getPlanForIdentity(identityId: string): Promise<PlanRow | null> {
  const row = await db.plans.where("identityId").equals(identityId).first();
  return row ?? null;
}

export async function updatePlan(id: number, steps: PlanStep[]): Promise<void> {
  const normalizedSteps = normalizePlanSteps(steps);
  const updatedAtISO = new Date().toISOString();
  await db.plans.update(id, {
    steps: normalizedSteps,
    updatedAtISO,
    doneCount: computeDoneCount(normalizedSteps),
  });
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
