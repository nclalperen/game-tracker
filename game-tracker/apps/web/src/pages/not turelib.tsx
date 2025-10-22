// import { useEffect, useMemo, useState } from "react";
// import { liveQuery } from "dexie";
// import { db } from "@/db";

// import RightDrawer from "@/components/RightDrawer";
// import ImportExport from "@/components/ImportExport";
// import ImportWizard from "@/components/ImportWizard";
// import GameCover from "@/components/GameCover";

// // Desktop bridge (safe no-op on web build)
// import { isTauri, fetchHLTB, fetchSteamPriceTRY } from "@/desktop/bridge";

// // Types and helpers from the shared core package
// import type { Identity, LibraryItem, Member, Account, Status } from "@tracker/core";
// import { pricePerHour } from "@tracker/core";

// /** ---------- Types ---------- */
// type Row = LibraryItem & {
//   identity?: Identity | null;
//   member?: Member | null;
//   account?: Account | null;
//   valueTRYperH?: number | null; // derived for table/card badges
// };

// const ALL = "ALL";

// function clearAllLocalData() {
//   return db.transaction("rw", db.members, db.accounts, db.identities, db.library, async () => {
//     await db.members.clear();
//     await db.accounts.clear();
//     await db.identities.clear();
//     await db.library.clear();
//   });
// }

// /** Join library items with identity/account/member and compute derived fields */
// function joinRows(
//   identities: Identity[],
//   items: LibraryItem[],
//   members: Member[],
//   accounts: Account[]
// ): Row[] {
//   const identById = new Map(identities.map((i) => [i.id, i]));
//   const memById = new Map(members.map((m) => [m.id, m]));
//   const accById = new Map(accounts.map((a) => [a.id, a]));

//   return items.map((it) => {
//     const identity = identById.get(it.identityId) || null;
//     const ttb = (identity as any)?.ttbMedianMainH as number | undefined;
//     return {
//       ...it,
//       identity,
//       member: it.memberId ? memById.get(it.memberId) || null : null,
//       account: it.accountId ? accById.get(it.accountId) || null : null,
//       valueTRYperH: it.priceTRY && ttb ? pricePerHour(it.priceTRY, ttb) : null,
//     };
//   });
// }

// export default function LibraryPage() {
//   const [rows, setRows] = useState<Row[]>([]);
//   const [members, setMembers] = useState<Member[]>([]);

//   // Filters & view
//   const [viewTable, setViewTable] = useState(false);
//   const [memberFilter, setMemberFilter] = useState<string>(ALL);
//   const [statusFilter, setStatusFilter] = useState<string>(ALL);
//   const [platformText, setPlatformText] = useState<string>("");
//   const [searchText, setSearchText] = useState<string>("");

//   // Import wizard and drawer
//   const [wizardOpen, setWizardOpen] = useState(false);
//   const [drawerRow, setDrawerRow] = useState<Row | null>(null);

//   // Live subscription to DB changes
//   useEffect(() => {
//     const sub = liveQuery(async () => {
//       const [idents, items, mems, accs] = await Promise.all([
//         db.identities.toArray(),
//         db.library.toArray(),
//         db.members.toArray(),
//         db.accounts.toArray(),
//       ]);
//       return {
//         rows: joinRows(idents, items, mems, accs),
//         members: mems,
//       };
//     }).subscribe({
//       next: ({ rows, members }) => {
//         setRows(rows);
//         setMembers(members);
//       },
//       error: (err) => console.error("liveQuery error", err),
//     });
//     return () => sub.unsubscribe();
//   }, []);

//   const filtered = useMemo(() => {
//     const s = searchText.trim().toLowerCase();
//     const p = platformText.trim().toLowerCase();
//     return rows.filter((r) => {
//       if (memberFilter !== ALL && (r.memberId ?? "everyone") !== memberFilter) return false;
//       if (statusFilter !== ALL && r.status !== (statusFilter as Status)) return false;
//       if (p) {
//         const rp = (r.identity?.platform || "").toLowerCase();
//         if (!rp.includes(p)) return false;
//       }
//       if (s) {
//         const title = (r.identity?.title || "").toLowerCase();
//         if (!title.includes(s)) return false;
//       }
//       return true;
//     });
//   }, [rows, memberFilter, statusFilter, platformText, searchText]);

//   return (
//     <div className="space-y-4">
//       {/* Toolbar */}
//       <div className="flex flex-wrap items-center gap-2">
//         <div className="inline-flex rounded overflow-hidden border border-zinc-200">
//           <button
//             className={"px-3 py-1 " + (!viewTable ? "bg-emerald-600 text-white" : "")}
//             onClick={() => setViewTable(false)}
//             title="Card view"
//           >
//             Cards
//           </button>
//           <button
//             className={"px-3 py-1 " + (viewTable ? "bg-emerald-600 text-white" : "")}
//             onClick={() => setViewTable(true)}
//             title="Table view"
//           >
//             Table
//           </button>
//         </div>

//         <button className="px-3 py-1.5 rounded bg-emerald-600 text-white" onClick={() => setWizardOpen(true)}>
//           Import Wizard
//         </button>
//         <ImportExport />

//         <button
//           className="ml-2 px-3 py-1.5 rounded border text-red-600"
//           onClick={async () => {
//             if (!confirm("This will delete ALL local data. Continue?")) return;
//             await clearAllLocalData();
//             localStorage.removeItem("seeded-v2");
//             location.reload();
//           }}
//         >
//           Clear Profile
//         </button>

//         <div className="ml-auto flex flex-wrap items-center gap-2">
//           <select
//             className="border rounded px-2 py-1"
//             value={memberFilter}
//             onChange={(e) => setMemberFilter(e.target.value)}
//             title="Filter by member"
//           >
//             <option value={ALL}>All members</option>
//             {members.map((m) => (
//               <option key={m.id} value={m.id}>
//                 {m.name}
//               </option>
//             ))}
//           </select>

//           <select
//             className="border rounded px-2 py-1"
//             value={statusFilter}
//             onChange={(e) => setStatusFilter(e.target.value)}
//             title="Filter by status"
//           >
//             <option value={ALL}>All statuses</option>
//             {["Backlog", "Playing", "Beaten", "Abandoned", "Wishlist", "Owned"].map((s) => (
//               <option key={s} value={s}>
//                 {s}
//               </option>
//             ))}
//           </select>

//           <input
//             className="border rounded px-2 py-1"
//             placeholder="Platform filter (pc/xbox/ps/switch...)"
//             value={platformText}
//             onChange={(e) => setPlatformText(e.target.value)}
//           />

//           <input
//             className="border rounded px-2 py-1"
//             placeholder="Search title…"
//             value={searchText}
//             onChange={(e) => setSearchText(e.target.value)}
//           />
//         </div>
//       </div>

//       {/* Main view */}
//       {viewTable ? (
//         <TableView
//           rows={filtered}
//           onEdit={(r) => setDrawerRow(r)}
//           onDelete={async (id) => {
//             await db.library.delete(id);
//           }}
//         />
//       ) : (
//         <CardGroups
//           rows={filtered}
//           onEdit={(r) => setDrawerRow(r)}
//           onDelete={async (id) => {
//             await db.library.delete(id);
//           }}
//         />
//       )}

//       {/* Right drawer editor */}
//       <RightDrawer
//         open={!!drawerRow}
//         onClose={() => setDrawerRow(null)}
//         title={drawerRow?.identity?.title || "Edit"}
//       >
//         {drawerRow && (
//           <Editor
//             key={drawerRow.id}
//             row={drawerRow}
//             onClose={() => setDrawerRow(null)}
//             onSaved={async () => {
//               // rows auto-refresh via liveQuery
//             }}
//           />
//         )}
//       </RightDrawer>

//       {/* Import wizard modal */}
//       <ImportWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
//     </div>
//   );
// }

// /** ---------- Cards (grouped by identity title) ---------- */
// function CardGroups({
//   rows,
//   onEdit,
//   onDelete,
// }: {
//   rows: Row[];
//   onEdit: (r: Row) => void;
//   onDelete: (id: string) => void;
// }) {
//   const groups = useMemo(() => {
//     const m = new Map<string, Row[]>();
//     for (const r of rows) {
//       const k = r.identity?.title || "Unknown";
//       if (!m.has(k)) m.set(k, []);
//       m.get(k)!.push(r);
//     }
//     return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
//   }, [rows]);

//   if (!groups.length) {
//     return <div className="text-sm text-zinc-500">Nothing to show. Try importing or adjust filters.</div>;
//   }

//   return (
//     <div className="space-y-6">
//       {groups.map(([title, groupRows]) => {
//         const identity = groupRows[0].identity || undefined;
//         const anyValue = groupRows.find((r) => r.valueTRYperH != null)?.valueTRYperH;
//         const badge = anyValue != null ? `₺/h: ${anyValue.toFixed(1)}` : undefined;

//         // choose "best" row by status priority
//         const order: Status[] = ["Playing", "Backlog", "Owned", "Wishlist", "Beaten", "Abandoned"];
//         const byStatus = new Map(order.map((s, i) => [s, i]));
//         const best = [...groupRows].sort((a, b) => {
//           const sa = byStatus.get(a.status as Status) ?? 999;
//           const sb = byStatus.get(b.status as Status) ?? 999;
//           return sa - sb;
//         })[0];

//         return (
//           <div key={title}>
//             <div className="flex items-center gap-3 mb-2">
//               <GameCover identity={identity} className="w-10 rounded" />
//               <h3 className="font-semibold">{title}</h3>
//               {badge && (
//                 <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">
//                   {badge}
//                 </span>
//               )}
//             </div>
//             <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
//               {groupRows.map((r) => (
//                 <div key={r.id} className="border rounded p-3 flex items-center gap-3">
//                   <div className="flex-1 text-sm text-zinc-700 space-y-1">
//                     <div>
//                       <span className="text-zinc-500 mr-2">Status:</span>
//                       {r.status || "Backlog"}
//                     </div>
//                     <div className="text-xs text-zinc-500">
//                       Account: {r.account?.label || "—"} • Member: {r.member?.name || "Everyone"}
//                     </div>
//                     {r.priceTRY != null && (
//                       <div>
//                         <span className="text-zinc-500 mr-2">Price:</span>₺{r.priceTRY}
//                       </div>
//                     )}
//                   </div>
//                   <div className="flex gap-2">
//                     <button className="px-2 py-1 border rounded" onClick={() => onEdit(best)}>
//                       Edit
//                     </button>
//                     <button
//                       className="px-2 py-1 border rounded text-red-600"
//                       onClick={() => onDelete(r.id!)}
//                     >
//                       Delete
//                     </button>
//                   </div>
//                 </div>
//               ))}
//             </div>
//           </div>
//         );
//       })}
//     </div>
//   );
// }

// /** ---------- Table View ---------- */
// function TableView({
//   rows,
//   onEdit,
//   onDelete,
// }: {
//   rows: Row[];
//   onEdit: (r: Row) => void;
//   onDelete: (id: string) => void;
// }) {
//   return (
//     <div className="overflow-x-auto border border-zinc-200 rounded-lg">
//       <table className="w-full text-sm">
//         <thead>
//           <tr className="text-left border-b">
//             <th className="py-2 pr-3">Cover</th>
//             <th className="py-2 pr-3">Title</th>
//             <th className="py-2 pr-3">Platform</th>
//             <th className="py-2 pr-3">Account</th>
//             <th className="py-2 pr-3">Member</th>
//             <th className="py-2 pr-3">Status</th>
//             <th className="py-2 pr-3">Price</th>
//             <th className="py-2 pr-3">TTB (h)</th>
//             <th className="py-2 pr-3">₺/h</th>
//             <th className="py-2 pr-3"></th>
//           </tr>
//         </thead>
//         <tbody>
//           {rows.map((r) => {
//             const ttb = (r.identity as any)?.ttbMedianMainH as number | undefined;
//             return (
//               <tr key={r.id} className="border-b">
//                 <td className="py-2 pr-3">
//                   <GameCover identity={r.identity || undefined} className="w-10 rounded" />
//                 </td>
//                 <td className="py-2 pr-3">{r.identity?.title}</td>
//                 <td className="py-2 pr-3">{r.identity?.platform || "PC"}</td>
//                 <td className="py-2 pr-3">{r.account?.label || "—"}</td>
//                 <td className="py-2 pr-3">{r.member?.name || "Everyone"}</td>
//                 <td className="py-2 pr-3">{r.status || "Backlog"}</td>
//                 <td className="py-2 pr-3">{r.priceTRY != null ? `₺${r.priceTRY}` : "—"}</td>
//                 <td className="py-2 pr-3">{ttb != null ? ttb : "—"}</td>
//                 <td className="py-2 pr-3">
//                   {r.valueTRYperH != null ? r.valueTRYperH.toFixed(1) : "—"}
//                 </td>
//                 <td className="py-2 pr-3">
//                   <div className="flex gap-2">
//                     <button className="px-2 py-1 border rounded" onClick={() => onEdit(r)}>
//                       Edit
//                     </button>
//                     <button
//                       className="px-2 py-1 border rounded text-red-600"
//                       onClick={() => onDelete(r.id!)}
//                     >
//                       Delete
//                     </button>
//                   </div>
//                 </td>
//               </tr>
//             );
//           })}

//           {!rows.length && (
//             <tr>
//               <td colSpan={10} className="py-6 text-center text-zinc-500">
//                 No items to show.
//               </td>
//             </tr>
//           )}
//         </tbody>
//       </table>
//     </div>
//   );
// }

// /** ---------- Editor in drawer ---------- */
// function Editor({
//   row,
//   onClose,
//   onSaved,
// }: {
//   row: Row;
//   onClose: () => void;
//   onSaved: () => Promise<void> | void;
// }) {
//   const [title, setTitle] = useState(row.identity?.title || "");
//   const [platform, setPlatform] = useState<Identity["platform"]>(row.identity?.platform || "PC");
//   const [appid, setAppid] = useState<number | "">(row.identity?.appid ?? "");
//   const [igdbCoverId, setIgdbCoverId] = useState<string>(
//     (row.identity as any)?.igdbCoverId || ""
//   );
//   const [status, setStatus] = useState<Status>(row.status || "Backlog");
//   const [priceTRY, setPriceTRY] = useState<number | "">(row.priceTRY ?? "");
//   const [ttb, setTtb] = useState<number | "">(
//     (row.identity as any)?.ttbMedianMainH ?? ""
//   );
//   const [ttbSource, setTtbSource] = useState<string | undefined>(
//     (row.identity as any)?.ttbSource
//   );

//   const [busyTTB, setBusyTTB] = useState(false);
//   const [busyPrice, setBusyPrice] = useState(false);

//   async function save() {
//     if (row.identity?.id) {
//       await db.identities.update(row.identity.id, {
//         title,
//         platform,
//         appid: typeof appid === "number" ? appid : undefined,
//         igdbCoverId: igdbCoverId || undefined,
//         ttbMedianMainH: typeof ttb === "number" ? ttb : undefined,
//         ...(ttbSource ? { ttbSource } : {}),
//       } as Partial<Identity> as any);
//     }
//     await db.library.update(row.id!, {
//       status,
//       priceTRY: typeof priceTRY === "number" ? priceTRY : undefined,
//     } as Partial<LibraryItem>);
//     await onSaved();
//     onClose();
//   }

//   async function onFetchHLTB() {
//     if (!isTauri) {
//       alert("Run the desktop app (Tauri) to fetch HLTB.");
//       return;
//     }
//     try {
//       setBusyTTB(true);
//       const hours = await fetchHLTB(title);
//       setTtb(hours ?? "");
//       setTtbSource(hours != null ? "hltb" : undefined);
//     } catch (err: any) {
//       alert(String(err?.message || err));
//     } finally {
//       setBusyTTB(false);
//     }
//   }

//   async function onFetchSteamPrice() {
//     const a =
//       typeof appid === "number"
//         ? appid
//         : Number(String(appid || "").trim()) || undefined;
//     if (!a) {
//       alert("Set a valid Steam AppID first.");
//       return;
//     }
//     if (!isTauri) {
//       alert("Run the desktop app (Tauri) to fetch Steam price.");
//       return;
//     }
//     try {
//       setBusyPrice(true);
//       const price = await fetchSteamPriceTRY(a, "tr");
//       if (price != null) setPriceTRY(price);
//       else alert("No price data for this app/region.");
//     } catch (err: any) {
//       alert(String(err?.message || err));
//     } finally {
//       setBusyPrice(false);
//     }
//   }

//   return (
//     <form
//       className="space-y-3"
//       onSubmit={async (e) => {
//         e.preventDefault();
//         await save();
//       }}
//     >
//       <div className="grid grid-cols-3 gap-3">
//         <label className="col-span-2">
//           <div className="text-xs text-zinc-500 mb-1">Title</div>
//           <input
//             className="w-full border rounded px-2 py-1"
//             value={title}
//             onChange={(e) => setTitle(e.target.value)}
//           />
//         </label>
//         <label>
//           <div className="text-xs text-zinc-500 mb-1">Platform</div>
//           <select
//             className="w-full border rounded px-2 py-1"
//             value={platform}
//             onChange={(e) => setPlatform(e.target.value as Identity["platform"])}
//           >
//             <option value="PC">PC</option>
//             <option value="Xbox">Xbox</option>
//             <option value="PlayStation">PlayStation</option>
//             <option value="Switch">Switch</option>
//             <option value="Android">Android</option>
//           </select>
//         </label>

//         <label>
//           <div className="text-xs text-zinc-500 mb-1">Steam AppID</div>
//           <input
//             className="w-full border rounded px-2 py-1"
//             value={appid}
//             onChange={(e) => {
//               const v = e.target.value.trim();
//               setAppid(v === "" ? "" : Number(v));
//             }}
//             placeholder="e.g. 620980"
//           />
//         </label>

//         <label>
//           <div className="text-xs text-zinc-500 mb-1">IGDB Cover ID</div>
//           <input
//             className="w-full border rounded px-2 py-1"
//             value={igdbCoverId}
//             onChange={(e) => setIgdbCoverId(e.target.value)}
//             placeholder="(optional)"
//           />
//         </label>

//         <label>
//           <div className="text-xs text-zinc-500 mb-1">Status</div>
//           <select
//             className="w-full border rounded px-2 py-1"
//             value={status}
//             onChange={(e) => setStatus(e.target.value as Status)}
//           >
//             {["Backlog", "Playing", "Beaten", "Abandoned", "Wishlist", "Owned"].map((s) => (
//               <option key={s} value={s}>
//                 {s}
//               </option>
//             ))}
//           </select>
//         </label>

//         <label>
//           <div className="text-xs text-zinc-500 mb-1">Price (₺)</div>
//           <input
//             className="w-full border rounded px-2 py-1"
//             value={priceTRY}
//             onChange={(e) => {
//               const v = e.target.value.trim();
//               setPriceTRY(v === "" ? "" : Number(v));
//             }}
//             placeholder="e.g. 299"
//           />
//         </label>

//         <label>
//           <div className="text-xs text-zinc-500 mb-1">TTB (median main, h)</div>
//           <input
//             className="w-full border rounded px-2 py-1"
//             value={ttb}
//             onChange={(e) => {
//               const v = e.target.value.trim();
//               setTtb(v === "" ? "" : Number(v));
//               if (v === "") setTtbSource(undefined);
//             }}
//             placeholder="e.g. 12.5"
//           />
//           {ttbSource && (
//             <div className="text-[10px] text-zinc-500 mt-0.5">
//               source: {ttbSource}
//             </div>
//           )}
//         </label>
//       </div>

//       <div className="flex gap-2">
//         <button
//           type="button"
//           onClick={onFetchHLTB}
//           disabled={busyTTB}
//           className={"px-3 py-1.5 border rounded " + (!isTauri ? "opacity-50 cursor-not-allowed" : "")}
//           title={!isTauri ? "Desktop-only (Tauri)" : undefined}
//         >
//           {busyTTB ? "Fetching HLTB…" : "Fetch HLTB (TTB)"}
//         </button>

//         <button
//           type="button"
//           onClick={onFetchSteamPrice}
//           disabled={busyPrice}
//           className={"px-3 py-1.5 border rounded " + (!isTauri ? "opacity-50 cursor-not-allowed" : "")}
//           title={!isTauri ? "Desktop-only (Tauri)" : undefined}
//         >
//           {busyPrice ? "Fetching Price…" : "Fetch Steam Price (₺)"}
//         </button>

//         <div className="ml-auto flex gap-2">
//           <button type="button" className="px-3 py-1.5 border rounded" onClick={onClose}>
//             Cancel
//           </button>
//           <button type="submit" className="px-3 py-1.5 rounded bg-emerald-600 text-white">
//             Save
//           </button>
//         </div>
//       </div>
//     </form>
//   );
// }
