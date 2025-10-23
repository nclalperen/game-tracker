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
class GTDb extends Dexie {
  identities!: Table<Identity, string>;
  accounts!: Table<Account, string>;
  members!: Table<Member, string>;
  library!: Table<LibraryItem, string>;

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
        identities: "id, title, platform, appid, igdbCoverId",
        accounts: "id, label, platform",
        members: "id, name",
        library: "id, identityId, accountId, memberId, status, acquiredAt",
      })
      .upgrade(async (tx) => {
        const table = tx.table("identities");
        await table.toCollection().modify((row: any) => {
          if (typeof row.appid === "undefined") row.appid = undefined;
          if (typeof row.igdbCoverId === "undefined") row.igdbCoverId = undefined;
        });
      });

    // ---------- v3: introduce ttbSource on library ----------
    this.version(3)
      .stores({
        identities: "id, title, platform, appid, igdbCoverId",
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
        identities: "id, title, platform, appid, igdbCoverId, ttbSource",
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

    // ---------- v5: add currencyCode to library ----------
    this.version(5)
      .stores({
        identities: "id, title, platform, appid, igdbCoverId, ttbSource",
        accounts: "id, label, platform",
        members: "id, name",
        library: "id, identityId, accountId, memberId, status, acquiredAt, currencyCode",
      })
      .upgrade(async (tx) => {
        const libTable = tx.table("library");
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
      });

    this.identities = this.table("identities");
    this.accounts = this.table("accounts");
    this.members = this.table("members");
    this.library = this.table("library");
  }
}

export const db = new GTDb();

/** Clear all app data (used by the "Clear Profile" button). */
export async function clearAllData() {
  await db.transaction(
    "rw",
    db.members,
    db.accounts,
    db.identities,
    db.library,
    async () => {
      await db.members.clear();
      await db.accounts.clear();
      await db.identities.clear();
      await db.library.clear();
    },
  );
}

/** Run a safe RW transaction across all tables. */
export async function withRW<T>(fn: () => Promise<T>) {
  return db.transaction(
    "rw",
    db.members,
    db.accounts,
    db.identities,
    db.library,
    fn,
  );
}
