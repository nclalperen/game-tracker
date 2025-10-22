import Dexie, { Table } from "dexie";
import type { Identity, Account, Member, LibraryItem } from "@tracker/core";

/**
 * Dexie database for the game tracker. Versions prior to 4 stored the
 * Time‑To‑Beat source (ttbSource) on library items. In version 4 this field
 * moves to the identities table. If you are migrating from an earlier
 * version the upgrade function will copy any existing ttbSource values
 * onto their corresponding identity records and remove the old field from
 * library rows.
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
        // ensure new fields exist (undefined) on old rows
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
        library:
          "id, identityId, accountId, memberId, status, acquiredAt, ttbSource",
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
        // copy existing ttbSource from library rows to identities
        await libTable.toCollection().each(async (row: any) => {
          if (row.ttbSource) {
            const identityId = row.identityId;
            const identity = await identTable.get(identityId);
            if (identity) {
              await identTable.update(identityId, { ttbSource: row.ttbSource });
            }
          }
        });
        // remove ttbSource from library rows
        await libTable.toCollection().modify((row: any) => {
          if ("ttbSource" in row) delete (row as any).ttbSource;
        });
      });

    // Attach tables
    this.identities = this.table("identities");
    this.accounts = this.table("accounts");
    this.members = this.table("members");
    this.library = this.table("library");
  }
}

/**
 * The single shared instance of the database. Import this wherever you need
 * to read or write from Dexie.
 */
export const db = new GTDb();

/**
 * Utility: clear all app data (used by “Clear Profile” button). Wraps in a
 * transaction for safety.
 */
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

/**
 * Utility: run a safe RW transaction across all tables. Example:
 *   await withRW(async () => { ... });
 */
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