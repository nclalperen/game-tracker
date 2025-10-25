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
};

export type RawgGameCache = {
  id: number;
  slug: string;
  title: string;
  titleKey: string;
  backgroundImage?: string | null;
  genres: string[];
  stores: RawgStoreInfo[];
  playtimeHours?: number | null;
  screenshotsCount?: number | null;
  metacriticScore?: number | null;
  rating?: number | null;
  ratingTop?: number | null;
  ratingsCount?: number | null;
  aggregatedScore?: number | null;
  updatedAtISO: string;
};
class GTDb extends Dexie {
  identities!: Table<Identity, string>;
  accounts!: Table<Account, string>;
  members!: Table<Member, string>;
  library!: Table<LibraryItem, string>;
  settings!: Table<{ key: string; value: unknown }, string>;
  rawgGames!: Table<RawgGameCache, number>;

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

    this.identities = this.table("identities");
    this.accounts = this.table("accounts");
    this.members = this.table("members");
    this.library = this.table("library");
    this.settings = this.table("settings");
    this.rawgGames = this.table("rawgGames");
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
};
export function isRawgGameStale(game: RawgGameCache, maxAgeDays = 30): boolean {
  const updated = Date.parse(game.updatedAtISO);
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

export async function upsertRawgGame(game: RawgGameCache): Promise<void> {
  const existing = await db.rawgGames.get(game.id);
  const merged: RawgGameCache = existing
    ? {
        ...existing,
        ...game,
        updatedAtISO: game.updatedAtISO || existing.updatedAtISO,
      }
    : {
        ...game,
        updatedAtISO: game.updatedAtISO || new Date().toISOString(),
      };
  await db.rawgGames.put(merged);
}
/** Clear all app data (used by the "Clear Profile" button). */
export async function clearAllData() {
  await db.transaction(
    "rw",
    [db.members, db.accounts, db.identities, db.library, db.settings, db.rawgGames],
    async () => {
      await db.members.clear();
      await db.accounts.clear();
      await db.identities.clear();
      await db.library.clear();
      await db.settings.clear();
      await db.rawgGames.clear();
    },
  );
}

/** Run a safe RW transaction across all tables. */
export async function withRW<T>(fn: () => Promise<T>) {
  return db.transaction(
    "rw",
    [db.members, db.accounts, db.identities, db.library, db.settings, db.rawgGames],
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












