
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
  /** Currency code for the price (e.g. "USD", "EUR"). Undefined when unknown */
  currencyCode?: string;
  identity?: Identity;
  member?: Member;
  account?: Account;
};

type ViewMode = "cards" | "table";
type StoreId = "steam" | "epic" | "ea" | "ubisoft" | "gog" | "microsoft" | "battlenet";

type StoreBadgeDetail = {
  label: string;
  badge: string;
};

const STORE_BADGE_DETAILS: Record<StoreId, StoreBadgeDetail> = {
  steam: { label: "Steam", badge: "Steam" },
  epic: { label: "Epic Games Store", badge: "Epic" },
  ea: { label: "EA App", badge: "EA" },
  ubisoft: { label: "Ubisoft Connect", badge: "Ubi" },
  gog: { label: "GOG.com", badge: "GOG" },
  microsoft: { label: "Microsoft Store", badge: "MS" },
  battlenet: { label: "Battle.net", badge: "B.net" },
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "EUR",
  GBP: "GBP",
  RUB: "RUB",
  ARS: "$",
  BRL: "R$",
  JPY: "JPY",
  AUD: "A$",
  CAD: "C$",
  TRY: "TRY",
  CNY: "CNY",
  MXN: "$",
  CLP: "$",
  KRW: "KRW",
  INR: "INR",
};

function formatCurrency(code?: string | null) {
  if (!code) return "-";
  const upper = code.toUpperCase();
  return CURRENCY_SYMBOLS[upper] ?? upper;
}

function inferStore(info: { identity?: Identity; account?: Account; services?: string[] }): StoreId | null {
  const { identity, account, services } = info;
  const haystack = [account?.label ?? "", account?.platform ?? "", ...(services ?? [])]
    .join(" ")
    .toLowerCase();

  const has = (needle: string) => haystack.includes(needle);

  if (identity?.appid) return "steam";
  if (has("steam")) return "steam";
  if (has("epic") || has("egs")) return "epic";
  if (has("gog")) return "gog";
  if (has("ubisoft") || has("uplay") || has("ubi connect") || has("ubisoft+")) return "ubisoft";
  if (has("battle.net") || has("battlenet") || has("blizzard") || has("bnet")) return "battlenet";
  if (has("game pass") || has("microsoft") || has("windows store") || has("xbox")) return "microsoft";
  if (has("ea play") || has("ea app") || has("origin") || /\bea\b/.test(haystack)) return "ea";

  return null;
}
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
  // Free-text search across game titles
  const [searchDraft, setSearchDraft] = useState<string>("");
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
    const handle = window.setTimeout(() => setSearchText(searchDraft.trim()), 150);
    return () => window.clearTimeout(handle);
  }, [searchDraft]);

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
          placeholder="Platform contains..."
          value={platformText}
          onChange={(e) => setPlatformText(e.target.value)}
        />

        <input
          className="input"
          placeholder="Search titles..."
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
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
        <div className="cards-grid">
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
                  <td className="px-2 py-1">{row.identity?.title ?? "-"}</td>
                  <td className="px-2 py-1">{row.identity?.platform ?? "-"}</td>
                  <td className="px-2 py-1">{row.status}</td>
                  <td className="px-2 py-1">
                    {row.priceTRY != null
                      ? `${formatCurrency(row.currencyCode)} ${row.priceTRY}`
                      : "-"}
                  </td>
                  <td className="px-2 py-1">{row.ttbMedianMainH ?? "-"}</td>
                  <td className="px-2 py-1">
                    {(() => {
                      const pph = pricePerHour(row.priceTRY, row.ttbMedianMainH);
                      if (pph == null) return "-";
                      const sym = formatCurrency(row.currencyCode);
                      return `${sym} ${pph}`;
                    })()}
                  </td>
                  <td className="px-2 py-1">{row.ocScore ?? "-"}</td>
                  <td className="px-2 py-1">{row.acquiredAt ?? "-"}</td>
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
  const identity = group.identity;
  const best = pickBestEntry(group.entries);
  const pph = pricePerHour(best.priceTRY, best.ttbMedianMainH);

  const platformLabel = identity?.platform;
  const isPc = platformLabel ? platformLabel.toLowerCase().includes("pc") : false;
  const storeId = isPc ? inferStore({ identity, account: best.account, services: best.services }) : null;
  const storeBadge = storeId ? { id: storeId, ...STORE_BADGE_DETAILS[storeId] } : null;
  const title = identity?.title ?? "Untitled";

  const currencyLabel = formatCurrency(best.currencyCode);

  return (
    <div className="card library-card">
      <div className="grid grid-cols-[96px_1fr] gap-3">
        <GameCover identity={identity} className="w-24" />

        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              <span className="text-base leading-tight">{title}</span>
              {platformLabel && (
                <span className="badge" title="Platform">
                  {platformLabel}
                </span>
              )}
              {storeBadge && (
                <span
                  className={`store-badge store-badge--${storeBadge.id}`}
                  title={storeBadge.label}
                  aria-label={`${storeBadge.label} store`}
                >
                  {storeBadge.badge}
                </span>
              )}
            </div>
            <div className="text-xs text-zinc-500">{group.entries.length} item(s)</div>
          </div>

          <div className="text-sm text-zinc-700 space-y-1">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
                Status: {best.status}
              </span>
              <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
                {currencyLabel}: {best.priceTRY ?? "-"}
              </span>
              <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
                TTB: {best.ttbMedianMainH ?? "-"}h
              </span>
              <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
                {currencyLabel}/h: {pph ?? "-"}
              </span>
              <span className="inline-block text-xs rounded bg-zinc-100 px-2 py-0.5">
                OC: {best.ocScore ?? "-"}
              </span>
            </div>

            <div className="text-xs text-zinc-500">
              Account: {best.account?.label || "-"} | Member: {best.member?.name || "Everyone"}
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

/** ---------- Editor Modal ---------- */
function Editor({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const open = !!row;
  const current = row ?? null;

  const { enabled: igdbOn, fetchMeta } = useIGDB();
  const { fetchScore } = useOpenCritic();
  const { enabled: hltbOn, fetchTTB } = useHLTB();

  const isTauri = typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);

  const [status, setStatus] = useState<Status>(current?.status ?? "Backlog");
  const [price, setPrice] = useState<number>(current?.priceTRY ?? 0);
  const [currency, setCurrency] = useState<string>(current?.currencyCode ?? "TRY");
  const [ttb, setTtb] = useState<number | null>(current?.ttbMedianMainH ?? null);
  const [score, setScore] = useState<number | null>(current?.ocScore ?? null);

  const currentAppid = current?.identity?.appid ?? null;
  const [appidInput, setAppidInput] = useState<string>(currentAppid ? String(currentAppid) : "");

  const [busyTTB, setBusyTTB] = useState(false);
  const [busyPrice, setBusyPrice] = useState(false);

  useEffect(() => {
    if (current) {
      setStatus(current.status);
      setPrice(current.priceTRY ?? 0);
      setCurrency(current.currencyCode ?? "TRY");
      setTtb(current.ttbMedianMainH ?? null);
      setScore(current.ocScore ?? null);
    }
  }, [current?.id]);

  useEffect(() => {
    setAppidInput(currentAppid ? String(currentAppid) : "");
  }, [currentAppid]);

  if (!open || !current) return null;

  const ocEnabled = flags.openCriticEnabled || localStorage.getItem("oc_enabled") === "1";
  const ocDisabled = !ocEnabled;

  const currencyLabel = (code: string | null | undefined) => formatCurrency(code);

  const updateIdentity = async (values: Partial<Identity>) => {
    if (!current.identity?.id) return;
    await db.identities.update(current.identity.id, values as any);
  };

  return (
    <Modal open={open} title={`Edit: ${current.identity?.title || ""}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();

          await db.library.update(current.id, {
            status,
            priceTRY: price,
            currencyCode: currency,
            ttbMedianMainH: ttb ?? undefined,
            ocScore: score ?? undefined,
          } as any);

          let nextSource: Identity["ttbSource"] | undefined = current.identity?.ttbSource;
          if (ttb == null) {
            nextSource = undefined;
          } else if (current.ttbMedianMainH !== ttb) {
            nextSource = "manual";
          }
          await updateIdentity({ ttbSource: nextSource });

          onClose();
          location.reload();
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-zinc-500">Status</label>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {(["Backlog", "Playing", "Beaten", "Abandoned", "Wishlist", "Owned"] as Status[]).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-zinc-500">Price ({currencyLabel(currency)})</label>
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

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn"
            disabled={!igdbOn}
            title={!igdbOn ? "IGDB integration is disabled" : "Fetch IGDB metadata (mock)"}
            onClick={async () => {
              try {
                if (!igdbOn) return;
                const title = current.identity?.title || "";
                if (!title) return alert("Missing title");
                const meta = await fetchMeta(title);
                if (meta.ttbMedianMainH != null) {
                  setTtb(meta.ttbMedianMainH);
                  await db.library.update(current.id, { ttbMedianMainH: meta.ttbMedianMainH } as any);
                  await updateIdentity({ ttbSource: "igdb" });
                }
                if (meta.igdbCoverId) {
                  await updateIdentity({ igdbCoverId: meta.igdbCoverId });
                }
              } catch (err: any) {
                alert(err?.message || String(err));
              }
            }}
          >
            Fetch IGDB
          </button>

          <button
            type="button"
            className="btn"
            disabled={ocDisabled}
            title={ocDisabled ? "OpenCritic is disabled (feature flag)" : "Fetch OpenCritic score"}
            onClick={async () => {
              try {
                const title = current.identity?.title || "";
                if (!title) return alert("Missing title");
                const res = await fetchScore(title);
                setScore(res?.ocScore ?? null);
              } catch (err: any) {
                alert(err?.message || String(err));
              }
            }}
          >
            Fetch OpenCritic
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn"
            disabled={!hltbOn || busyTTB}
            title={!hltbOn ? "Desktop-only (Tauri)" : "Fetch HowLongToBeat (main median)"}
            onClick={async () => {
              try {
                setBusyTTB(true);
                const title = current.identity?.title || "";
                if (!title) return alert("Missing title");
                const meta = await fetchTTB(title);
                if (meta.mainMedianHours != null) {
                  setTtb(meta.mainMedianHours);
                  await db.library.update(current.id, { ttbMedianMainH: meta.mainMedianHours } as any);
                  const src = meta.source === "hltb-cache" ? "hltb-cache" : "hltb";
                  await updateIdentity({ ttbSource: src });
                } else {
                  alert("No HLTB result.");
                }
              } catch (err: any) {
                alert(err?.message || String(err));
              } finally {
                setBusyTTB(false);
              }
            }}
          >
            Fetch HLTB / TTB
          </button>

          <div />
        </div>

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
                  } catch (_err) {
                    result = null;
                  }
                  if (result) break;
                }
                if (!result) {
                  alert("No price available for this or fallback regions.");
                  return;
                }
                setPrice(result.price);
                setCurrency(result.currency);
                await db.library.update(current.id, { priceTRY: result.price, currencyCode: result.currency } as any);
              } catch (err: any) {
                alert(err?.message || String(err));
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
                const parsed = parseAppId(appidInput);
                if (!parsed) return alert("Enter a valid appid or Steam app URL.");
                if (!current.identity?.id) return alert("Missing identity.");
                await db.identities.update(current.identity.id, { appid: parsed } as any);
                setAppidInput("");
                alert(`Saved appid ${parsed}. You can now fetch price.`);
                location.reload();
              }}
              disabled={!appidInput || String(currentAppid ?? "") === appidInput.trim()}
            >
              Set appid
            </button>
          </div>
        </div>

        <div className="pt-2 flex items-center justify-between">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn bg-red-600 hover:bg-red-700"
              onClick={async () => {
                if (!confirm(`Delete this entry: "${current.identity?.title}"`)) return;
                await db.library.delete(current.id);
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

function pickBestEntry(entries: Row[]): Row {
  const order: Status[] = ["Playing", "Backlog", "Owned", "Wishlist", "Beaten", "Abandoned"];
  const byStatus = new Map(order.map((s, i) => [s, i] as const));
  return ([...entries].sort((a, b) => {
    const sa = byStatus.get(a.status) ?? 999;
    const sb = byStatus.get(b.status) ?? 999;
    return sa - sb;
  })[0] || entries[0]);
}
