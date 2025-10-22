// import { useEffect, useMemo, useState } from "react";
// import { db } from "@/db";
// import ImportWizard from "@/components/ImportWizard";
// import Modal from "@/components/Modal";
// import GameCover from "@/components/GameCover";
// import { useHLTB } from "@/hooks/useHLTB";
// import { fetchHLTB, fetchSteamPriceTRY } from "@/desktop/bridge";

// import {
//   pricePerHour,
//   flags,
//   type Identity,
//   type LibraryItem,
//   type Member,
//   type Account,
//   type Status,
// } from "@tracker/core";

// import { useOpenCritic } from "@/hooks/useOpenCritic";
// import { useIGDB } from "@/hooks/useIGDB";

// /** ---------- Types & helpers ---------- */

// type Row = LibraryItem & {
//   ttbSource?: "hltb" | "igdb" | "manual";
//   identity?: Identity;
//   member?: Member;
//   account?: Account;
// };


// type ViewMode = "cards" | "table";
// const ALL = "ALL";

// function parseAppId(input: string): number | null {
//   const s = input.trim();
//   if (!s) return null;
//   // numeric only
//   if (/^\d+$/.test(s)) return Number(s);
//   // try URL: https://store.steampowered.com/app/APPID/...
//   const m = s.match(/store\.steampowered\.com\/app\/(\d+)/i);
//   if (m) return Number(m[1]);
//   return null;
// }

// /** ---------- Page ---------- */

// export default function LibraryPage() {
//   const [rows, setRows] = useState<Row[]>([]);
//   const [view, setView] = useState<ViewMode>("cards");

//   // Filters
//   const [memberFilter, setMemberFilter] = useState<string>(ALL);
//   const [statusFilter, setStatusFilter] = useState<string>(ALL);
//   const [platformText, setPlatformText] = useState<string>("");

//   // data for filters
//   const [members, setMembers] = useState<Member[]>([]);
//   const [statuses] = useState<Status[]>([
//     "Backlog",
//     "Playing",
//     "Beaten",
//     "Abandoned",
//     "Wishlist",
//     "Owned",
//   ]);

//   // Import wizard
//   const [wizardOpen, setWizardOpen] = useState(false);

//   // Editor
//   const [editing, setEditing] = useState<Row | null>(null);

//   useEffect(() => {
//     (async () => {
//       const [idents, accs, mems, libs] = await Promise.all([
//         db.identities.toArray(),
//         db.accounts.toArray(),
//         db.members.toArray(),
//         db.library.toArray(),
//       ]);
//       const identById = new Map(idents.map((i) => [i.id, i]));
//       const accById = new Map(accs.map((a) => [a.id, a]));
//       const memById = new Map(mems.map((m) => [m.id, m]));

//       setMembers(mems);

//       const joined: Row[] = libs.map((li) => ({
//         ...li,
//         identity: identById.get(li.identityId),
//         account: li.accountId ? accById.get(li.accountId) : undefined,
//         member: li.memberId ? memById.get(li.memberId) : undefined,
//       }));

//       setRows(joined);
//     })();
//   }, []);

//   const filtered = useMemo(() => {
//     return rows.filter((r) => {
//       if (memberFilter !== ALL && (r.memberId ?? "everyone") !== memberFilter) return false;
//       if (statusFilter !== ALL && r.status !== statusFilter) return false;
//       if (platformText.trim()) {
//         const p = (r.identity?.platform || "").toLowerCase();
//         if (!p.includes(platformText.trim().toLowerCase())) return false;
//       }
//       return true;
//     });
//   }, [rows, memberFilter, statusFilter, platformText]);

//   // Group by identity for “Inbox Library” cards
//   const grouped = useMemo(() => {
//     const m = new Map<string, Row[]>();
//     for (const r of filtered) {
//       const key = r.identityId;
//       if (!m.has(key)) m.set(key, []);
//       m.get(key)!.push(r);
//     }
//     return [...m.entries()].map(([identityId, list]) => ({
//       identityId,
//       identity: list[0]?.identity,
//       entries: list,
//     }));
//   }, [filtered]);

//   async function clearProfile() {
//     if (!confirm("This will delete all local data. Continue?")) return;
//     await db.transaction("rw", db.members, db.accounts, db.identities, db.library, async () => {
//       await db.members.clear();
//       await db.accounts.clear();
//       await db.identities.clear();
//       await db.library.clear();
//     });
//     localStorage.removeItem("seeded-v2");
//     location.reload();
//   }

//   async function handleFetchHLTB(title: string) {
//     try {
//       setBusyTTB(true);
//       const hours = await fetchHLTB(title);
//       setTtb(hours ?? null);
//       setTtbSource(hours != null ? "hltb" : undefined);
//       // persist to DB if you’d like:
//       if (row.identity?.id) {
//         await db.identities.update(row.identity.id, {
//           ttbMedianMainH: hours ?? undefined,
//           ttbSource: hours != null ? "hltb" : undefined,
//         });
//       }
//     } catch (e: any) {
//       alert(`HLTB error: ${e?.message || e}`);
//     } finally {
//       setBusyTTB(false);
//     }
//   }

//   async function handleFetchSteamPrice(appid?: number) {
//     if (!appid) return;
//     try {
//       setBusyPrice(true);
//       const price = await fetchSteamPriceTRY(appid);
//       if (price != null) {
//         setPriceTRY(price);
//         await db.library.update(row.id!, { priceTRY: price });
//       } else {
//         alert("No price found for this region/app.");
//       }
//     } catch (e: any) {
//       alert(`Steam price error: ${e?.message || e}`);
//     } finally {
//       setBusyPrice(false);
//     }
//   }

//   return (
//     <div className="space-y-4">
//       {/* Toolbar */}
//       <div className="flex flex-wrap items-center gap-2">
//         <div className="inline-flex rounded overflow-hidden border border-zinc-200">
//           <button
//             className={`px-3 py-1 ${view === "cards" ? "bg-emerald-600 text-white" : ""}`}
//             onClick={() => setView("cards")}
//           >
//             Cards
//           </button>
//           <button
//             className={`px-3 py-1 ${view === "table" ? "bg-emerald-600 text-white" : ""}`}
//             onClick={() => setView("table")}
//           >
//             Table
//           </button>
//         </div>

//         <button className="btn" onClick={() => setWizardOpen(true)}>
//           Import Wizard
//         </button>

//         <button className="btn-ghost" onClick={clearProfile}>
//           Clear Profile
//         </button>

//         <div className="ml-auto flex items-center gap-2">
//           <select
//             className="select"
//             value={memberFilter}
//             onChange={(e) => setMemberFilter(e.target.value)}
//             title="Filter by Member"
//           >
//             <option value={ALL}>All members</option>
//             {members.map((m) => (
//               <option key={m.id} value={m.id}>
//                 {m.name}
//               </option>
//             ))}
//           </select>

//           <select
//             className="select"
//             value={statusFilter}
//             onChange={(e) => setStatusFilter(e.target.value)}
//             title="Filter by Status"
//           >
//             <option value={ALL}>All statuses</option>
//             {statuses.map((s) => (
//               <option key={s} value={s}>
//                 {s}
//               </option>
//             ))}
//           </select>

//           <input
//             className="input"
//             placeholder="Platform filter (pc/xbox/ps/... )"
//             value={platformText}
//             onChange={(e) => setPlatformText(e.target.value)}
//             title="Quick platform filter"
//           />
//         </div>
//       </div>

//       {/* Main view */}
//       {view === "cards" ? (
//         <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
//           {grouped.map((g) => (
//             <CardGroup key={g.identityId} group={g} onEdit={(r) => setEditing(r)} />
//           ))}
//           {grouped.length === 0 && (
//             <div className="text-sm text-zinc-500">
//               Nothing to show. Try changing filters or import some data.
//             </div>
//           )}
//         </div>
//       ) : (
//         <div className="overflow-auto border border-zinc-200 rounded-lg">
//           <table className="table">
//             <thead>
//               <tr>
//                 <th>Cover</th>
//                 <th>Title</th>
//                 <th>Platform</th>
//                 <th>Account</th>
//                 <th>Member</th>
//                 <th>Status</th>
//                 <th>Price</th>
//                 <th>TTB (h)</th>
//                 <th>₺/h</th>
//                 <th>OC</th>
//                 <th>Date</th>
//                 <th></th>
//               </tr>
//             </thead>

//             <tbody>
//               {filtered.map((row) => (
//                 <tr key={row.id}>
//                   <td>
//                     <GameCover identity={row.identity} className="w-12" />
//                   </td>
//                   <td>{row.identity?.title}</td>
//                   <td>{row.identity?.platform}</td>
//                   <td>{row.account?.label || "—"}</td>
//                   <td>{row.member?.name || "Everyone"}</td>
//                   <td>{row.status}</td>
//                   <td>{row.priceTRY ?? "—"}</td>
//                   <td>{row.ttbMedianMainH ?? "—"}</td>
//                   <td>{pricePerHour(row.priceTRY, row.ttbMedianMainH) ?? "—"}</td>
//                   <td>{row.ocScore ?? "—"}</td>
//                   <td>{row.acquiredAt ?? "—"}</td>
//                   <td>
//                     <button className="btn-ghost" onClick={() => setEditing(row)}>
//                       Edit
//                     </button>
//                   </td>
//                 </tr>
//               ))}

//               {filtered.length === 0 && (
//                 <tr>
//                   <td colSpan={12} className="text-sm text-zinc-500">
//                     Nothing to show. Try changing filters or import some data.
//                   </td>
//                 </tr>
//               )}
//             </tbody>
//           </table>
//         </div>

//       )}

//       {/* Import Wizard */}
//       <ImportWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

//       {/* Editor */}
//       <Editor row={editing} onClose={() => setEditing(null)} />
//     </div>
//   );
// }

// /** ---------- Cards (grouped by Identity) ---------- */

// function CardGroup({
//   group,
//   onEdit,
// }: {
//   group: { identityId: string; identity?: Identity; entries: Row[] };
//   onEdit: (r: Row) => void;
// }) {
//   const id = group.identity;
//   const best = pickBestEntry(group.entries);
//   const pph = pricePerHour(best.priceTRY, best.ttbMedianMainH);

//   return (
//     <div className="card">
//       <div className="grid grid-cols-[96px_1fr] gap-3">
//         <GameCover identity={id} className="w-24" />

//         <div>
//           <div className="flex items-center justify-between mb-1">
//             <div className="font-semibold">
//               {id?.title}{" "}
//               <span className="badge" title="Platform">
//                 {id?.platform}
//               </span>
//             </div>
//             <div className="text-xs text-zinc-500">{group.entries.length} item(s)</div>
//           </div>

//           <div className="text-sm text-zinc-700 space-y-1">
//             <div className="flex flex-wrap gap-2 items-center">
//               <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
//                 Status: {best.status}
//               </span>
//               <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
//                 ₺: {best.priceTRY ?? "—"}
//               </span>
//               <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
//                 TTB: {best.ttbMedianMainH ?? "—"}h
//               </span>
//               <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
//                 ₺/h: {pph ?? "—"}
//               </span>
//               <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
//                 OC: {best.ocScore ?? "—"}
//               </span>
//             </div>

//             <div className="text-xs text-zinc-500">
//               Account: {best.account?.label || "—"} • Member: {best.member?.name || "Everyone"}
//             </div>

//             <div className="pt-2">
//               <button className="btn" onClick={() => onEdit(best)}>
//                 Edit
//               </button>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }

// function pickBestEntry(entries: Row[]): Row {
//   // preference: Playing > Backlog > Owned > Wishlist > others; otherwise first entry
//   const order: Status[] = ["Playing", "Backlog", "Owned", "Wishlist", "Beaten", "Abandoned"];
//   const byStatus = new Map(order.map((s, i) => [s, i]));
//   return (
//     [...entries].sort((a, b) => {
//       const sa = byStatus.get(a.status) ?? 999;
//       const sb = byStatus.get(b.status) ?? 999;
//       return sa - sb;
//     })[0] || entries[0]
//   );
// }

// /** ---------- Editor Modal ---------- */

// function Editor({ row, onClose }: { row: Row | null; onClose: () => void }) {
//   const open = !!row;
//   const r = row as Row | null;
//   const { enabled: igdbOn, fetchMeta } = useIGDB();
//   const { fetchScore } = useOpenCritic();
//   const { enabled: hltbOn, fetchTTB } = useHLTB();
//   const prevSource =
//   (r as any)?.ttbSource as "hltb" | "igdb" | "manual" | undefined;


  

//   const [status, setStatus] = useState<Status>(r?.status ?? "Backlog");
//   const [price, setPrice] = useState<number>(r?.priceTRY ?? 0);
//   const [ttb, setTtb] = useState<number | null>(r?.ttbMedianMainH ?? null);
//   const [score, setScore] = useState<number | null>(r?.ocScore ?? null);

//   // appid helpers
//   const currentAppid = r?.identity?.appid ?? null;
//   const [appidInput, setAppidInput] = useState<string>("");

//   useEffect(() => {
//     if (r) {
//       setStatus(r.status);
//       setPrice(r.priceTRY ?? 0);
//       setTtb(r.ttbMedianMainH ?? null);
//       setScore(r.ocScore ?? null);
//     }
//   }, [r?.id]);

//   if (!open || !r) return null;

//   const ocDisabled = !flags.openCriticEnabled;
//   const igdbDisabled = !flags.igdbEnabled;

//   return (
//     <Modal open={open} title={`Edit: ${r.identity?.title || ""}`} onClose={onClose}>
//       <form
//         className="space-y-3"
//         onSubmit={async (e) => {
//           e.preventDefault();
//           await db.library.update(r.id, {
//             status,
//             priceTRY: price,
//             ttbMedianMainH: ttb ?? undefined,
//             ocScore: score ?? undefined,
//             ttbSource: ttb != null
//               ? (r.ttbMedianMainH !== ttb ? "manual" : prevSource)
//               : prevSource,
//           } as any);
//           onClose(); location.reload();
//         }}
//       >
//         <div className="grid grid-cols-2 gap-2">
//           <div>
//             <label className="text-xs text-zinc-500">Status</label>
//             <select
//               className="select"
//               value={status}
//               onChange={(e) => setStatus(e.target.value as Status)}
//             >
//               {["Backlog", "Playing", "Beaten", "Abandoned", "Wishlist", "Owned"].map((s) => (
//                 <option key={s} value={s}>
//                   {s}
//                 </option>
//               ))}
//             </select>
//           </div>

//           <div>
//             <label className="text-xs text-zinc-500">Price (₺)</label>
//             <input
//               className="input"
//               type="number"
//               value={price}
//               onChange={(e) => setPrice(Number(e.target.value))}
//             />
//           </div>

//           <div>
//             <label className="text-xs text-zinc-500">TTB Median (h)</label>
//             <input
//               className="input"
//               type="number"
//               value={ttb ?? 0}
//               onChange={(e) => setTtb(Number(e.target.value))}
//             />
//           </div>

//           <div>
//             <label className="text-xs text-zinc-500">OpenCritic Score</label>
//             <input
//               className="input"
//               type="number"
//               value={score ?? 0}
//               onChange={(e) => setScore(Number(e.target.value))}
//             />
//           </div>
//         </div>

//         {/* Integration buttons */}
//         <div className="grid grid-cols-2 gap-2">
//           <button
//             type="button"
//             className="btn"
//             disabled={ocDisabled}
//             onClick={async () => {
//               if (!flags.openCriticEnabled) {
//                 alert("OpenCritic is disabled (feature flag).");
//                 return;
//               }
//               try {
//                 const title = r.identity?.title || "";
//                 if (!title) return alert("Missing title");
//                 const res = await fetchScore(title);
//                 setScore(res?.ocScore ?? null);
//               } catch (e: any) {
//                 alert(e?.message || String(e));
//               }
//             }}
//           >
//             Fetch OpenCritic
//           </button>
          
//             <button
//               type="button"
//               className="btn"
//               disabled={!hltbOn}
//               title={!hltbOn ? "Desktop-only (Tauri) in this MVP" : "Fetch HowLongToBeat (Main median)"}
//               onClick={async () => {
//                 try {
//                   const title = r.identity?.title || "";
//                   if (!title) return alert("Missing title");
//                   const meta = await fetchTTB(title); // { mainMedianHours, source }
//                   if (meta.mainMedianHours != null) {
//                     setTtb(meta.mainMedianHours);
//                     await db.library.update(r.id, {
//                       ttbMedianMainH: meta.mainMedianHours,
//                       ttbSource: "hltb",
//                     } as any);
//                   } else {
//                     alert("No HLTB result.");
//                   }
//                 } catch (e: any) {
//                   alert(e?.message || String(e));
//                 }
//               }}
//             >
//               Fetch HLTB / TTB
//             </button>

          
//         </div>

//         {/* Desktop-only price fetch */}
//         <div className="grid grid-cols-2 gap-2">
//           <button
//             type="button"
//             className="btn"
//             disabled={!isTauri || !currentAppid}
//             title={
//               !isTauri
//                 ? "Run the Desktop app (Tauri) to enable"
//                 : !currentAppid
//                 ? "No Steam appid on this identity"
//                 : "Fetch current price (TRY)"
//             }
//             onClick={async () => {
//               try {
//                 if (!currentAppid) return alert("This game has no Steam appid.");
//                 const p = await fetchSteamPriceTRY(currentAppid, "tr");
//                 if (p == null) return alert("No price available for this region.");
//                 setPrice(p);
//               } catch (e: any) {
//                 alert(e?.message || String(e));
//               }
//             }}
//           >
//             Fetch Steam Price (₺)
//           </button>
//           <button
//             type="button"
//             className="btn"
//             disabled={busyTTB}
//             onClick={() => handleFetchHLTB(row.identity?.title || "")}
//           >
//             Fetch HLTB
//           </button>

//           <button
//             type="button"
//             className="btn"
//             disabled={busyPrice || !row.identity?.appid}
//             onClick={() => handleFetchSteamPrice(row.identity?.appid)}
//           >
//             Fetch Steam Price (TRY)
//           </button>

//           <div className="grid grid-cols-[1fr_auto] gap-2">
//             <input
//               className="input"
//               placeholder="Paste Steam app URL or appid"
//               value={appidInput}
//               onChange={(e) => setAppidInput(e.target.value)}
//               title="Example: https://store.steampowered.com/app/1145360/"
//             />
//             <button
//               type="button"
//               className="btn-ghost"
//               onClick={async () => {
//                 const id = parseAppId(appidInput);
//                 if (!id) return alert("Enter a valid appid or Steam app URL.");
//                 if (!r?.identity?.id) return alert("Missing identity.");
//                 await db.identities.update(r.identity.id, { appid: id });
//                 setAppidInput("");
//                 alert(`Saved appid ${id}. You can now fetch price.`);
//                 // reload to refresh local editor copy
//                 location.reload();
//               }}
//             >
//               Set appid
//             </button>
//           </div>
//         </div>

//         {/* Footer actions */}
//         <div className="pt-2 flex items-center justify-between">
//           <button type="button" className="btn-ghost" onClick={onClose}>
//             Cancel
//           </button>

//           <div className="flex items-center gap-2">
//             <button
//               type="button"
//               className="btn bg-red-600 hover:bg-red-700"
//               onClick={async () => {
//                 if (!confirm(`Delete this entry: “${r.identity?.title}”?`)) return;
//                 await db.library.delete(r.id);
//                 onClose();
//                 location.reload();
//               }}
//             >
//               Delete
//             </button>
//             <button className="btn" type="submit">
//               Save
//             </button>
//           </div>
//         </div>
//       </form>
//     </Modal>
//   );
// }
