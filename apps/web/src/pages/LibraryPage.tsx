
import { useEffect, useMemo, useState } from "react";
import { db } from "@/db";
import ImportWizard from "@/components/ImportWizard";
import Modal from "@/components/Modal";
import GameCover from "@/components/GameCover";
import { useHLTB } from "@/hooks/useHLTB";
import { useOpenCritic } from "@/hooks/useOpenCritic";
import { useIGDB } from "@/hooks/useIGDB";
// Desktop bridge (used only for Steam price in this page)
import { fetchSteamPrice } from "@/desktop/bridge";

import {
  pricePerHour,
  flags,
  type Identity,
  type LibraryItem,
  type Member,
  type Account,
  type Status,
} from "@tracker/core";

/** ---------- Types & helpers ---------- */
type Row = LibraryItem & {
  /** Local extras we persist on the library row (Dexie stores unindexed props fine) */
  ttbMedianMainH?: number | null;
  ocScore?: number | null;
  ttbSource?: "hltb" | "hltb-cache" | "igdb" | "manual";
  /** Currency code for the price (e.g. "USD", "EUR").  Undefined when unknown */
  priceCurrency?: string;
  identity?: Identity;
  member?: Member;
  account?: Account;
};

type ViewMode = "cards" | "table";
const ALL = "ALL" as const;

function parseAppId(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/store\.steampowered\.com\/app\/(\d+)/i);
  return m ? Number(m[1]) : null;
}

/** ---------- Page ---------- */
export default function LibraryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<ViewMode>("cards");

  // Filters
  const [memberFilter, setMemberFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [platformText, setPlatformText] = useState<string>("");
  // Free‑text search across game titles
  const [searchText, setSearchText] = useState<string>("");

  // data for filters
  const [members, setMembers] = useState<Member[]>([]);
  const [statuses] = useState<Status[]>([
    "Backlog",
    "Playing",
    "Beaten",
    "Abandoned",
    "Wishlist",
    "Owned",
  ]);

  // Import wizard
  const [wizardOpen, setWizardOpen] = useState(false);

  // Editor
  const [editing, setEditing] = useState<Row | null>(null);

  useEffect(() => {
    (async () => {
      const [idents, accs, mems, libs] = await Promise.all([
        db.identities.toArray(),
        db.accounts.toArray(),
        db.members.toArray(),
        db.library.toArray(),
      ]);
      const identById = new Map(idents.map((i) => [i.id, i] as const));
      const accById = new Map(accs.map((a) => [a.id, a] as const));
      const memById = new Map(mems.map((m) => [m.id, m] as const));

      setMembers(mems);

      const joined: Row[] = libs.map((li) => ({
        ...li,
        identity: identById.get(li.identityId),
        account: li.accountId ? accById.get(li.accountId) : undefined,
        member: li.memberId ? memById.get(li.memberId) : undefined,
      }));
      setRows(joined);
    })();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (memberFilter !== ALL && (r.memberId ?? "everyone") !== memberFilter) return false;
      if (statusFilter !== ALL && r.status !== statusFilter) return false;
      if (platformText.trim()) {
        const p = (r.identity?.platform || "").toLowerCase();
        if (!p.includes(platformText.trim().toLowerCase())) return false;
      }
      if (searchText.trim()) {
        const s = searchText.trim().toLowerCase();
        const title = r.identity?.title?.toLowerCase() || "";
        if (!title.includes(s)) return false;
      }
      return true;
    });
  }, [rows, memberFilter, statusFilter, platformText, searchText]);

  // Group by identity for card view
  const grouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of filtered) {
      const key = r.identityId;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return [...m.entries()].map(([identityId, list]) => ({
      identityId,
      identity: list[0]?.identity,
      entries: list,
    }));
  }, [filtered]);

  async function clearProfile() {
    if (!confirm("This will delete all local data. Continue?")) return;
    await db.transaction("rw", db.members, db.accounts, db.identities, db.library, async () => {
      await db.members.clear();
      await db.accounts.clear();
      await db.identities.clear();
      await db.library.clear();
    });
    localStorage.removeItem("seeded-v2");
    location.reload();
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <select
          className="select"
          value={memberFilter}
          onChange={(e) => setMemberFilter(e.target.value)}
          title="Filter by member"
        >
          <option value={ALL}>All members</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          title="Filter by status"
        >
          <option value={ALL}>All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <input
          className="input"
          placeholder="Platform contains…"
          value={platformText}
          onChange={(e) => setPlatformText(e.target.value)}
        />

        <input
          className="input"
          placeholder="Search titles…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          title="Search games by title"
        />

        <div className="flex-1" />

        <button className="btn" onClick={() => setWizardOpen(true)}>
          Import Wizard
        </button>
        <button className="btn-ghost" onClick={clearProfile}>
          Clear Profile
        </button>
        <button className="btn-ghost" onClick={() => setView(view === "cards" ? "table" : "cards")}>
          View: {view === "cards" ? "Cards" : "Table"}
        </button>
      </div>

      {/* Cards */}
      {view === "cards" && (
        /*
         * Use a fixed-width grid for cards.  Each card has a minimum and maximum
         * width equal to the CSS custom property --card-w.  This prevents cards
         * from stretching when there is extra horizontal space and allows
         * additional columns to appear naturally as the window grows.
         */
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(var(--card-w,280px),var(--card-w,280px)))]">
          {grouped.map((g) => (
            <CardGroup key={g.identityId} group={g} onEdit={setEditing} />
          ))}
          {grouped.length === 0 && (
            <div className="text-sm text-zinc-500">Nothing to show. Try changing filters or import.</div>
          )}
        </div>
      )}

      {/* Table */}
      {view === "table" && (
        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="px-2 py-1">Title</th>
                <th className="px-2 py-1">Platform</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Price</th>
                <th className="px-2 py-1">TTB (h)</th>
                <th className="px-2 py-1">Price/h</th>
                <th className="px-2 py-1">OC</th>
                <th className="px-2 py-1">Acquired</th>
                <th className="px-2 py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td className="px-2 py-1">{row.identity?.title ?? "—"}</td>
                  <td className="px-2 py-1">{row.identity?.platform ?? "—"}</td>
                  <td className="px-2 py-1">{row.status}</td>
                  <td className="px-2 py-1">
                    {row.priceTRY != null
                      ? ((row.priceCurrency?.toUpperCase() ?? "₺") + " " + row.priceTRY)
                      : "—"}
                  </td>
                  <td className="px-2 py-1">{row.ttbMedianMainH ?? "—"}</td>
                  <td className="px-2 py-1">
                    {(() => {
                      const pph = pricePerHour(row.priceTRY, row.ttbMedianMainH);
                      if (pph == null) return "—";
                      const sym = row.priceCurrency?.toUpperCase() ?? "₺";
                      return `${sym} ${pph}`;
                    })()}
                  </td>
                  <td className="px-2 py-1">{row.ocScore ?? "—"}</td>
                  <td className="px-2 py-1">{row.acquiredAt ?? "—"}</td>
                  <td className="px-2 py-1">
                    <button className="btn-ghost" onClick={() => setEditing(row)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-sm text-zinc-500">
                    Nothing to show. Try changing filters or import some data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Import Wizard */}
      <ImportWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      {/* Editor */}
      <Editor row={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

/** ---------- Cards (grouped by Identity) ---------- */
function CardGroup({
  group,
  onEdit,
}: {
  group: { identityId: string; identity?: Identity; entries: Row[] };
  onEdit: (r: Row) => void;
}) {
  const id = group.identity;
  const best = pickBestEntry(group.entries);
  const pph = pricePerHour(best.priceTRY, best.ttbMedianMainH);

  // Resolve a currency symbol from the row’s currency code.  Many Steam
  // regions use USD pricing (e.g. Turkey/MENA, Argentina) so we map common
  // ISO codes to symbols.  If we do not recognize the code we fall back to
  // the raw code (e.g. "ARS" → "ARS").
  const currencySymbols: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    RUB: "₽",
    ARS: "$", // Argentine Peso now priced in USD on Steam; use $ symbol
    BRL: "R$",
    JPY: "¥",
    AUD: "A$",
    CAD: "C$",
    TRY: "₺",
    CNY: "¥",
    MXN: "$",
    CLP: "$",
    KRW: "₩",
    INR: "₹",
  };
  const priceCurrency = best.priceCurrency?.toUpperCase();
  const currencySymbol = priceCurrency && currencySymbols[priceCurrency] ? currencySymbols[priceCurrency] : priceCurrency;

  return (
    <div className="card">
      <div className="grid grid-cols-[96px_1fr] gap-3">
        <GameCover identity={id} className="w-24" />

        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="font-semibold">
              {id?.title}{" "}
              <span className="badge" title="Platform">
                {id?.platform}
              </span>
            </div>
            <div className="text-xs text-zinc-500">{group.entries.length} item(s)</div>
          </div>

          <div className="text-sm text-zinc-700 space-y-1">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
                Status: {best.status}
              </span>
              <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
                {currencySymbol ?? "₺"}: {best.priceTRY ?? "—"}
              </span>
              <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
                TTB: {best.ttbMedianMainH ?? "—"}h
              </span>
              <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
                {(currencySymbol ?? "₺")}/h: {pph ?? "—"}
              </span>
              <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
                OC: {best.ocScore ?? "—"}
              </span>
            </div>

            <div className="text-xs text-zinc-500">
              Account: {best.account?.label || "—"} • Member: {best.member?.name || "Everyone"}
            </div>

            <div className="pt-2">
              <button className="btn" onClick={() => onEdit(best)}>
                Edit
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// preference: Playing > Backlog > Owned > Wishlist > others; otherwise first entry
function pickBestEntry(entries: Row[]): Row {
  const order: Status[] = ["Playing", "Backlog", "Owned", "Wishlist", "Beaten", "Abandoned"];
  const byStatus = new Map(order.map((s, i) => [s, i] as const));
  return ([...entries].sort((a, b) => {
    const sa = byStatus.get(a.status) ?? 999;
    const sb = byStatus.get(b.status) ?? 999;
    return sa - sb;
  })[0] || entries[0]);
}

/** ---------- Editor Modal ---------- */
function Editor({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const open = !!row;
  const r = row as Row | null;

  const { enabled: igdbOn, fetchMeta } = useIGDB();
  const { fetchScore } = useOpenCritic();
  const { enabled: hltbOn, fetchTTB } = useHLTB();

  // runtime desktop (Tauri) guard
  const isTauri = typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);

  const [status, setStatus] = useState<Status>(r?.status ?? "Backlog");
  // price and currency are separate fields.  price is a number (e.g. 22.99) and
  // currency is a string like "USD", "EUR", etc.
  const [price, setPrice] = useState<number>(r?.priceTRY ?? 0);
  const [currency, setCurrency] = useState<string>(r?.priceCurrency ?? "TRY");
  const [ttb, setTtb] = useState<number | null>(r?.ttbMedianMainH ?? null);
  const [score, setScore] = useState<number | null>(r?.ocScore ?? null);

  // appid helpers
  const currentAppid = r?.identity?.appid ?? null;
  const [appidInput, setAppidInput] = useState<string>(currentAppid ? String(currentAppid) : "");

  const [busyTTB, setBusyTTB] = useState(false);
  const [busyPrice, setBusyPrice] = useState(false);
  
  useEffect(() => {
    if (r) {
      setStatus(r.status);
      setPrice(r.priceTRY ?? 0);
      setCurrency(r.priceCurrency ?? "TRY");
      setTtb(r.ttbMedianMainH ?? null);
      setScore(r.ocScore ?? null);
    }
  }, [r?.id]);

  // keep it in sync when user opens a different row
  useEffect(() => {
    setAppidInput(currentAppid ? String(currentAppid) : "");
  }, [currentAppid]);

  if (!open || !r) return null;

  const ocEnabled = flags.openCriticEnabled || localStorage.getItem("oc_enabled") === "1";
  const ocDisabled = !ocEnabled;
  const igdbDisabled = !igdbOn;

  return (
    <Modal open={open} title={`Edit: ${r.identity?.title || ""}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await db.library.update(r.id, {
            status,
            priceTRY: price,
            priceCurrency: currency,
            ttbMedianMainH: ttb ?? undefined,
            ocScore: score ?? undefined,
            // When user edits TTB manually we stamp source to "manual"
            ttbSource:
              ttb != null ? (r.ttbMedianMainH !== ttb ? "manual" : r.ttbSource) : r.ttbSource,
          } as any);
          onClose();
          location.reload();
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-zinc-500">Status</label>
            <select
              className="select"
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
            >
              {["Backlog", "Playing", "Beaten", "Abandoned", "Wishlist", "Owned"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-zinc-500">Price ({(() => {
              // Map a few common currency codes to symbols.  If we do not
              // recognize the code we return the uppercase ISO code.
              const map: Record<string, string> = {
                USD: "$",
                EUR: "€",
                GBP: "£",
                RUB: "₽",
                ARS: "$", // Argentine Peso is priced in USD on Steam; show $
                BRL: "R$",
                JPY: "¥",
                AUD: "A$",
                CAD: "C$",
                TRY: "₺",
                CNY: "¥",
                MXN: "$",
                CLP: "$",
                KRW: "₩",
                INR: "₹",
              };
              const cc = currency?.toUpperCase();
              return (cc && map[cc]) ? map[cc] : cc;
            })()})</label>
            <input
              className="input"
              type="number"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="text-xs text-zinc-500">TTB Median (h)</label>
            <input
              className="input"
              type="number"
              value={ttb ?? 0}
              onChange={(e) => setTtb(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="text-xs text-zinc-500">OpenCritic Score</label>
            <input
              className="input"
              type="number"
              value={score ?? 0}
              onChange={(e) => setScore(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Integration buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn"
            disabled={ocDisabled}
            title={ocDisabled ? "OpenCritic is disabled (feature flag)" : "Fetch OpenCritic score"}
            onClick={async () => {
              try {
                const title = r.identity?.title || "";
                if (!title) return alert("Missing title");
                const res = await fetchScore(title);
                setScore(res?.ocScore ?? null);
              } catch (e: any) {
                alert(e?.message || String(e));
              }
            }}
          >
            Fetch OpenCritic
          </button>

          <button
            type="button"
            className="btn"
            disabled={!hltbOn || busyTTB}
            title={!hltbOn ? "Desktop-only (Tauri) in this MVP" : "Fetch HowLongToBeat (Main median)"}
            onClick={async () => {
              try {
                setBusyTTB(true);
                const title = r.identity?.title || "";
                if (!title) return alert("Missing title");
                const meta = await fetchTTB(title); // { mainMedianHours, source }
                if (meta.mainMedianHours != null) {
                  setTtb(meta.mainMedianHours);
                  // Map the source returned from the hook to our internal value.  The hook
                  // returns "hltb", "hltb-cache" or "html"; treat HTML fallback
                  // as "hltb" in the DB.
                  const src = (() => {
                    if (meta.source === "hltb-cache") return "hltb-cache" as const;
                    if (meta.source === "hltb") return "hltb" as const;
                    return "hltb" as const;
                  })();
                  await db.library.update(r.id, {
                    ttbMedianMainH: meta.mainMedianHours,
                    ttbSource: src,
                  } as any);
                } else {
                  alert("No HLTB result.");
                }
              } catch (e: any) {
                alert(e?.message || String(e));
              } finally {
                setBusyTTB(false);
              }
            }}
          >
            Fetch HLTB / TTB
          </button>
        </div>

        {/* Desktop-only price fetch */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn"
            disabled={!isTauri || !currentAppid || busyPrice}
            title={
              !isTauri
                ? "Desktop-only"
                : !currentAppid
                ? "No Steam appid on this identity"
                : (() => {
                    const cc = localStorage.getItem("steam_cc") || "us";
                    return `Fetch current price (${cc.toUpperCase()})`;
                  })()
            }
            onClick={async () => {
              try {
                if (!currentAppid) return alert("This game has no Steam appid.");
                setBusyPrice(true);
                // Region preference from settings; fallback to a list of regions if price isn't available.
                const prefs = [
                  (localStorage.getItem("steam_cc") || "us").toLowerCase(),
                  "us",
                  "gb",
                  "eu",
                  "de",
                  "fr",
                  "tr",
                  "jp",
                  "au",
                ];
                let result: { price: number; currency: string } | null = null;
                for (const region of prefs) {
                  try {
                    result = await fetchSteamPrice(currentAppid, region);
                  } catch (_e) {
                    result = null;
                  }
                  if (result) break;
                }
                if (!result) {
                  alert("No price available for this or fallback regions.");
                  return;
                }
                const { price: p, currency: cur } = result;
                setPrice(p);
                setCurrency(cur);
                await db.library.update(r.id, { priceTRY: p, priceCurrency: cur } as any);
              } catch (e: any) {
                alert(e?.message || String(e));
              } finally {
                setBusyPrice(false);
              }
            }}
          >
            Fetch Steam Price
          </button>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              className="input"
              placeholder="Paste Steam app URL or appid"
              value={appidInput}
              onChange={(e) => setAppidInput(e.target.value)}
              title="Example: https://store.steampowered.com/app/1145360/"
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={async () => {
                const id = parseAppId(appidInput);
                if (!id) return alert("Enter a valid appid or Steam app URL.");
                if (!r?.identity?.id) return alert("Missing identity.");
                await db.identities.update(r.identity.id, { appid: id } as any);
                setAppidInput("");
                alert(`Saved appid ${id}. You can now fetch price.`);
                location.reload();
              }}
              disabled={!appidInput || String(currentAppid||"") === appidInput.trim()}
            >
              Set appid
            </button>
          </div>
        </div>

        {/* Footer actions */}
        <div className="pt-2 flex items-center justify-between">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn bg-red-600 hover:bg-red-700"
              onClick={async () => {
                if (!confirm(`Delete this entry: “${r.identity?.title}”?`)) return;
                await db.library.delete(r.id);
                onClose();
                location.reload();
              }}
            >
              Delete
            </button>
            <button className="btn" type="submit">
              Save
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
