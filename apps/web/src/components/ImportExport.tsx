import { db } from "@/db";
import { toCSV, parseCSV } from "@tracker/core";
import { useState } from "react";

export default function ImportExport() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn" disabled={busy} onClick={async () => {
        setBusy(true);
        const [identities, library, accounts, members] = await Promise.all([
          db.identities.toArray(),
          db.library.toArray(),
          db.accounts.toArray(),
          db.members.toArray()
        ]);
        const blob = new Blob([JSON.stringify({identities, library, accounts, members}, null, 2)], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        download(url, "game-tracker-export.json");
        setBusy(false);
      }}>Export JSON</button>

      <button className="btn" disabled={busy} onClick={async () => {
        setBusy(true);
        const rows = await db.library.toArray();
        const csv = toCSV(rows);
        const url = URL.createObjectURL(new Blob([csv], {type: "text/csv"}));
        download(url, "library.csv");
        setBusy(false);
      }}>Export CSV</button>

      <label className="btn-ghost">
        <input type="file" accept=".json,.csv" hidden onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const text = await file.text();
          if (file.name.endsWith(".json")) {
            const data = JSON.parse(text);
            await db.transaction("rw", db.identities, db.library, db.accounts, db.members, async () => {
              if (data.identities?.length) await db.identities.bulkPut(data.identities);
              if (data.library?.length) await db.library.bulkPut(data.library);
              if (data.accounts?.length) await db.accounts.bulkPut(data.accounts);
              if (data.members?.length) await db.members.bulkPut(data.members);
            });
            alert("Imported JSON.");
          } else {
            const rows = parseCSV(text);
            // Minimal CSV import into library table
            await db.library.bulkPut(rows.map((r) => ({
              id: r.id || crypto.randomUUID(),
              identityId: r.identityId,
              accountId: r.accountId || undefined,
              memberId: r.memberId || undefined,
              status: (r.status as any) || "Backlog",
              priceTRY: r.priceTRY ? Number(r.priceTRY) : undefined,
              acquiredAt: r.acquiredAt || undefined,
              ocScore: r.ocScore ? Number(r.ocScore) : undefined,
              ttbMedianMainH: r.ttbMedianMainH ? Number(r.ttbMedianMainH) : undefined
            })));
            alert("Imported CSV into library.");
          }
          e.currentTarget.value = "";
        }}/>
        Import JSON/CSV
      </label>
    </div>
  );
}

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
