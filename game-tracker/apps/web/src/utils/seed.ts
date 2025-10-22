import { db } from "@/db";
import type { Identity, LibraryItem, Member, Account } from "@tracker/core";

export async function ensureSeed() {
  const key = "seeded-v2";
  if (localStorage.getItem(key)) return;

  const count = await db.library.count();
  if (count > 0) {
    localStorage.setItem(key, "1");
    return;
  }

  const members: Member[] = [
    { id: "everyone", name: "Everyone" },
    { id: "you", name: "You" },
    { id: "hatice", name: "Hatice" },
  ];

  const accounts: Account[] = [
    { id: "steam", platform: "PC", label: "Steam" },
  ];

  const identities: Identity[] = [
    { id: "id-hades", title: "Hades", platform: "PC", appid: 1145360 },
    { id: "id-ori", title: "Ori and the Will of the Wisps", platform: "Xbox" },
  ];

  const library: LibraryItem[] = [
    { id: "li1", identityId: "id-hades", accountId: "steam", memberId: "you", status: "Backlog", priceTRY: 299, ttbMedianMainH: 20, ocScore: 93 },
    { id: "li2", identityId: "id-ori", memberId: "everyone", status: "Playing" },
  ];

  await db.transaction("rw", db.members, db.accounts, db.identities, db.library, async () => {
    await db.members.bulkPut(members);
    await db.accounts.bulkPut(accounts);
    await db.identities.bulkPut(identities);
    await db.library.bulkPut(library);
  });

  localStorage.setItem(key, "1");
}
