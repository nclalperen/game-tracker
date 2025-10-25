// // apps/web/src/db.ts
// import Dexie, { Table } from "dexie";
// import type {
//   Identity,
//   Account,
//   Member,
//   LibraryItem,
// } from "@tracker/core";

// /**
//  * Dexie Database
//  * - v1: base schema
//  * - v2: identities add appid, igdbCoverId
//  * - v3: library add ttbSource
//  */
// class GTDb extends Dexie {
//   identities!: Table<Identity, string>;
//   accounts!: Table<Account, string>;
//   members!: Table<Member, string>;
//   library!: Table<LibraryItem, string>;

//   constructor() {
//     super("game-tracker");

//     // ---------- v1: base schema ----------
//     this.version(1).stores({
//       identities: "id, title, platform",
//       accounts: "id, label, platform",
//       members: "id, name",
//       library: "id, identityId, accountId, memberId, status, acquiredAt",
//     });

//     // ---------- v2: add appid & igdbCoverId to identities ----------
//     this.version(2)
//       .stores({
//         identities: "id, title, platform, appid, igdbCoverId",
//         accounts: "id, label, platform",
//         members: "id, name",
//         library: "id, identityId, accountId, memberId, status, acquiredAt",
//       })
//       .upgrade(async (tx) => {
//         const table = tx.table("identities");
//         // ensure new fields exist (undefined) on old rows
//         await table.toCollection().modify((row: any) => {
//           if (typeof row.appid === "undefined") row.appid = undefined;
//           if (typeof row.igdbCoverId === "undefined") row.igdbCoverId = undefined;
//         });
//       });

//     // ---------- v3: add ttbSource to library ----------
//     this.version(3)
//       .stores({
//         identities: "id, title, platform, appid, igdbCoverId",
//         accounts: "id, label, platform",
//         members: "id, name",
//         library:
//           "id, identityId, accountId, memberId, status, acquiredAt, ttbSource",
//       })
//       .upgrade(async (tx) => {
//         const table = tx.table("library");
//         await table.toCollection().modify((row: any) => {
//           if (typeof row.ttbSource === "undefined") row.ttbSource = undefined;
//         });
//       });

//     // Attach tables
//     this.identities = this.table("identities");
//     this.accounts = this.table("accounts");
//     this.members = this.table("members");
//     this.library = this.table("library");
//   }
// }

// export const db = new GTDb();

// /**
//  * Utility: clear all app data (used by â€œClear Profileâ€ button).
//  * Wraps in a transaction for safety.
//  */
// export async function clearAllData() {
//   await db.transaction("rw", db.members, db.accounts, db.identities, db.library, async () => {
//     await db.members.clear();
//     await db.accounts.clear();
//     await db.identities.clear();
//     await db.library.clear();
//   });
// }

// /**
//  * Utility: run a safe RW transaction across all tables.
//  * Example:
//  *   await withRW(async () => { ... });
//  */
// export async function withRW<T>(fn: () => Promise<T>) {
//   return db.transaction("rw", db.members, db.accounts, db.identities, db.library, fn);
// }
