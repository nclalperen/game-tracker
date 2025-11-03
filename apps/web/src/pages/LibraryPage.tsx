
import {
  KeyboardEvent,
  MouseEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  db,
  getLibrarySort,
  setLibrarySort,
  getSetting,
  setSetting,
  upsertSteamAchievementsRow,
  type SteamOwnedRow,
  type SteamRecentRow,
} from "@/db";
import Modal from "@/components/Modal";
import GameCover from "@/components/GameCover";
import ReOnboarding from "@/components/ReOnboarding";
import { DataInspector } from "@/components/DataInspector";
import { ErrorBoundary as UIErrorBoundary } from "@/ui/ErrorBoundary";
import { useIGDB } from "@/hooks/useIGDB";
import { useHLTB } from "@/hooks/useHLTB";
import { getMCEntry, loadMCIndex, mcKey } from "@/data/metacriticIndex";
import type { RawgGameCache } from "@/db";
import { ensureRawgDetail, getCachedRawgDetail } from "@/data/rawgCache";
import { isTauri, fetchOpenCriticScore, fetchSteamPrice } from "@/desktop/bridge";
import {
  ensureSteamId,
  getOwnedGames,
  getPlayerAchievements,
  getRecentlyPlayed,
  getSteamProfile,
} from "@/desktop/steamBridge";
// Inline detail expansion is used instead of a Drawer
import { useVendorFlag } from "@/state/vendorFlags";

import {
  pricePerHour,
  flags,
  type Identity,
  type LibraryItem,
  type Member,
  type Account,
  type Status,
  normalizeTitle,
} from "@tracker/core";

/** ---------- Types & helpers ---------- */
type Row = LibraryItem & {
  /** Local extras we persist on the library row (Dexie stores unindexed props fine) */
  ttbMedianMainH?: number | null;
  ocScore?: number | null;
  mcScore?: number | null;

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

type SortField =
  | "title"
  | "platform"
  | "status"
  | "price"
  | "ttb"
  | "pph"
  | "oc"
  | "mc"
  | "acquired";
type SortDirection = "asc" | "desc";
type CriticSourceFilter = "any" | "metacritic" | "opencritic" | "rawg" | "none";

const SORT_FIELDS: SortField[] = [
  "title",
  "platform",
  "status",
  "price",
  "ttb",
  "pph",
  "oc",
  "mc",
  "acquired",
];

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

function inferStore(
  info: { identity?: Identity; account?: Account; services?: string[] },
  rawgStores?: RawgGameCache["stores"],
): StoreId | null {
  const { identity, account, services } = info;

  if (rawgStores && rawgStores.length) {
    const names = rawgStores.map((s) => s.name.toLowerCase());
    const hasRawg = (needle: string) => names.some((name) => name.includes(needle));
    if (hasRawg("steam")) return "steam";
    if (hasRawg("epic")) return "epic";
    if (hasRawg("gog")) return "gog";
    if (hasRawg("ubisoft") || hasRawg("uplay")) return "ubisoft";
    if (hasRawg("battle") || hasRawg("blizzard")) return "battlenet";
    if (hasRawg("microsoft") || hasRawg("xbox")) return "microsoft";
    if (hasRawg("ea")) return "ea";
  }
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

const GameDetails = lazy(() => import("../components/details/GameDetails"));
const ImportWizard = lazy(() => import("@/components/ImportWizard"));

function prefetchGameDetailsLazy(identityId: string) {
  void import("../components/details/GameDetails")
    .then((mod) => {
      if (typeof mod.prefetchGameDetails === "function") {
        mod.prefetchGameDetails(identityId);
      }
    })
    .catch(() => {});
}

function invalidateGameDetailsLazy(identityId: string) {
  void import("../components/details/GameDetails")
    .then((mod) => {
      if (typeof mod.invalidateGameDetails === "function") {
        mod.invalidateGameDetails(identityId);
      }
    })
    .catch(() => {});
}

function resetSteamCacheLazy(next: string | null) {
  void import("../components/details/GameDetails")
    .then((mod) => {
      if (typeof mod.resetSteamUserIdCache === "function") {
        mod.resetSteamUserIdCache(next);
      }
    })
    .catch(() => {});
}

function parseAppId(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/store\.steampowered\.com\/app\/(\d+)/i);
  return m ? Number(m[1]) : null;
}

function parseNumericInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function parseDateInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

/** ---------- Page ---------- */
export default function LibraryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<ViewMode>("cards");
  const [nowPlaying, setNowPlaying] = useState<{ appId: number; name?: string } | null>(null);
  const [steamPersona, setSteamPersona] = useState<string | null>(null);

  // Filters
  const [memberFilter, setMemberFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [platformText, setPlatformText] = useState<string>("");
  // Free-text search across game titles
  const [searchDraft, setSearchDraft] = useState<string>("");
  const [searchText, setSearchText] = useState<string>("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Advanced filters
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [ttbMin, setTtbMin] = useState("");
  const [ttbMax, setTtbMax] = useState("");
  const [pphMin, setPphMin] = useState("");
  const [pphMax, setPphMax] = useState("");
  const [ocMin, setOcMin] = useState("");
  const [mcMin, setMcMin] = useState("");
  const [acquiredAfter, setAcquiredAfter] = useState("");
  const [acquiredBefore, setAcquiredBefore] = useState("");
  const [requirePrice, setRequirePrice] = useState(false);
  const [requireTTB, setRequireTTB] = useState(false);
  const [requireScore, setRequireScore] = useState(false);
  const [criticSourceFilter, setCriticSourceFilter] = useState<CriticSourceFilter>("any");

  // Sorting
  const [sortState, setSortState] = useState<{ field: SortField; direction: SortDirection }>({
    field: "title",
    direction: "asc",
  });

  const { field: sortField, direction: sortDirection } = sortState;

  useEffect(() => {
    let cancelled = false;
    getLibrarySort()
      .then((stored) => {
        if (!stored || cancelled) return;
        const { field, direction } = stored;
        if (!SORT_FIELDS.includes(field as SortField)) return;
        if (direction !== "asc" && direction !== "desc") return;
        setSortState((prev) => {
          if (prev.field === field && prev.direction === direction) {
            return prev;
          }
          return { field: field as SortField, direction: direction as SortDirection };
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let interval: number | null = null;

    const loadNowPlaying = async () => {
      try {
        const steamId = await getSetting<string>("steam.myId");
        if (!steamId || cancelled) {
          if (!cancelled) {
            setNowPlaying(null);
            setSteamPersona(null);
          }
          return;
        }
        const profile = await getSteamProfile(steamId);
        if (cancelled) return;
        setSteamPersona(profile.personaName ?? null);
        const appId = profile.nowPlayingGameId ? Number(profile.nowPlayingGameId) : NaN;
        if (Number.isFinite(appId) && appId > 0) {
          setNowPlaying({ appId, name: profile.nowPlayingGameName ?? undefined });
        } else {
          setNowPlaying(null);
        }
      } catch {
        if (!cancelled) {
          setNowPlaying(null);
          setSteamPersona(null);
        }
      }
    };

    void loadNowPlaying();
    interval = window.setInterval(loadNowPlaying, 60_000);

    return () => {
      cancelled = true;
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, []);

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

  const rawgEnabled = useVendorFlag("rawg");

  const [openId, setOpenId] = useState<string | null>(null);

  // Editor
  const [editing, setEditing] = useState<Row | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

  useEffect(() => {
    if (!toast) return;
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 4000);
    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
    };
  }, [toast]);

  useEffect(() => {
    const handle = window.setTimeout(() => setSearchText(searchDraft.trim()), 150);
    return () => window.clearTimeout(handle);
  }, [searchDraft]);

  const toggleDetails = useCallback((identityId: string) => {
    setOpenId((prev) => (prev === identityId ? null : identityId));
  }, []);

  const loadRows = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    const handler = () => {
      void loadRows();
    };
    window.addEventListener("gt:library-reload", handler);
    return () => {
      window.removeEventListener("gt:library-reload", handler);
    };
  }, [loadRows]);

  useEffect(() => {
    const showHandler: EventListener = () => setWizardOpen(true);
    const hideHandler: EventListener = () => setWizardOpen(false);
    window.addEventListener("gt:show-enrichment", showHandler);
    window.addEventListener("gt:hide-enrichment", hideHandler);
    return () => {
      window.removeEventListener("gt:show-enrichment", showHandler);
      window.removeEventListener("gt:hide-enrichment", hideHandler);
    };
  }, []);

  const filtered = useMemo(() => {
    const priceMinVal = parseNumericInput(priceMin);
    const priceMaxVal = parseNumericInput(priceMax);
    const ttbMinVal = parseNumericInput(ttbMin);
    const ttbMaxVal = parseNumericInput(ttbMax);
    const pphMinVal = parseNumericInput(pphMin);
    const pphMaxVal = parseNumericInput(pphMax);
    const ocMinVal = parseNumericInput(ocMin);
    const mcMinVal = parseNumericInput(mcMin);
    const acquiredAfterTs = parseDateInput(acquiredAfter);
    const acquiredBeforeTs = parseDateInput(acquiredBefore);

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

      const price = typeof r.priceTRY === "number" ? r.priceTRY : null;
      const ttb = typeof r.ttbMedianMainH === "number" ? r.ttbMedianMainH : null;
      const pph = pricePerHour(r.priceTRY, r.ttbMedianMainH);
      const ocScore = r.identity?.ocScore ?? r.ocScore ?? null;
      const mcScore = r.identity?.mcScore ?? r.mcScore ?? null;
      const rawSource = r.identity?.criticScoreSource ?? null;
      const normalizedSource: CriticSourceFilter | null =
        rawSource ?? (mcScore != null ? "metacritic" : ocScore != null ? "opencritic" : null);
      const hasScore = mcScore != null || ocScore != null;

      if (requirePrice && price == null) return false;
      if (requireTTB && ttb == null) return false;
      if (requireScore && !hasScore) return false;

      if (priceMinVal != null && (price == null || price < priceMinVal)) return false;
      if (priceMaxVal != null && (price == null || price > priceMaxVal)) return false;

      if (ttbMinVal != null && (ttb == null || ttb < ttbMinVal)) return false;
      if (ttbMaxVal != null && (ttb == null || ttb > ttbMaxVal)) return false;

      if (pphMinVal != null && (pph == null || pph < pphMinVal)) return false;
      if (pphMaxVal != null && (pph == null || pph > pphMaxVal)) return false;

      if (ocMinVal != null && (ocScore == null || ocScore < ocMinVal)) return false;
      if (mcMinVal != null && (mcScore == null || mcScore < mcMinVal)) return false;

      if (criticSourceFilter === "metacritic" && normalizedSource !== "metacritic") return false;
      if (criticSourceFilter === "opencritic" && normalizedSource !== "opencritic") return false;
      if (criticSourceFilter === "rawg" && normalizedSource !== "rawg") return false;
      if (criticSourceFilter === "none" && (normalizedSource !== null || hasScore)) return false;

      if (acquiredAfterTs != null || acquiredBeforeTs != null) {
        const acquiredTs = r.acquiredAt ? Date.parse(r.acquiredAt) : Number.NaN;
        if (acquiredAfterTs != null && (Number.isNaN(acquiredTs) || acquiredTs < acquiredAfterTs)) {
          return false;
        }
        if (acquiredBeforeTs != null && (Number.isNaN(acquiredTs) || acquiredTs > acquiredBeforeTs)) {
          return false;
        }
      }

      return true;
    });
  }, [
    rows,
    memberFilter,
    statusFilter,
    platformText,
    searchText,
    priceMin,
    priceMax,
    ttbMin,
    ttbMax,
    pphMin,
    pphMax,
    ocMin,
    mcMin,
    acquiredAfter,
    acquiredBefore,
    requirePrice,
    requireTTB,
    requireScore,
    criticSourceFilter,
  ]);

  const tableRows = useMemo(() => {
    const sorted = [...filtered];
    const multiplier = sortDirection === "asc" ? 1 : -1;

    const compareStrings = (a: string, b: string) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }) * multiplier;
    const compareNumbers = (a: number | null | undefined, b: number | null | undefined) => {
      const aNum = typeof a === "number" && Number.isFinite(a) ? a : null;
      const bNum = typeof b === "number" && Number.isFinite(b) ? b : null;
      if (aNum === null && bNum === null) return 0;
      if (aNum === null) return 1 * multiplier;
      if (bNum === null) return -1 * multiplier;
      return (aNum - bNum) * multiplier;
    };

    sorted.sort((a, b) => {
      switch (sortField) {
        case "title":
          return compareStrings(a.identity?.title ?? "", b.identity?.title ?? "") || compareStrings(a.id, b.id);
        case "platform":
          return compareStrings(a.identity?.platform ?? "", b.identity?.platform ?? "") || compareStrings(a.id, b.id);
        case "status":
          return compareStrings(a.status, b.status) || compareStrings(a.id, b.id);
        case "price":
          return compareNumbers(a.priceTRY ?? null, b.priceTRY ?? null) || compareStrings(a.id, b.id);
        case "ttb":
          return compareNumbers(a.ttbMedianMainH ?? null, b.ttbMedianMainH ?? null) || compareStrings(a.id, b.id);
        case "pph": {
          const pphA = pricePerHour(a.priceTRY, a.ttbMedianMainH);
          const pphB = pricePerHour(b.priceTRY, b.ttbMedianMainH);
          return compareNumbers(pphA, pphB) || compareStrings(a.id, b.id);
        }
        case "oc": {
          const ocA = a.identity?.ocScore ?? a.ocScore ?? null;
          const ocB = b.identity?.ocScore ?? b.ocScore ?? null;
          return compareNumbers(ocA, ocB) || compareStrings(a.id, b.id);
        }
        case "mc": {
          const mcA = a.identity?.mcScore ?? a.mcScore ?? null;
          const mcB = b.identity?.mcScore ?? b.mcScore ?? null;
          return compareNumbers(mcA, mcB) || compareStrings(a.id, b.id);
        }
        case "acquired": {
          const aTime = a.acquiredAt ? Date.parse(a.acquiredAt) : Number.NaN;
          const bTime = b.acquiredAt ? Date.parse(b.acquiredAt) : Number.NaN;
          return compareNumbers(
            Number.isNaN(aTime) ? null : aTime,
            Number.isNaN(bTime) ? null : bTime,
          ) || compareStrings(a.id, b.id);
        }
        default:
          return compareStrings(a.identity?.title ?? "", b.identity?.title ?? "");
      }
    });

    return sorted;
  }, [filtered, sortField, sortDirection]);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const tableVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 48,
    overscan: 8,
  });
  const virtualRows = tableVirtualizer.getVirtualItems();
  const totalTableSize = tableVirtualizer.getTotalSize();
  const tablePaddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const tablePaddingBottom =
    virtualRows.length > 0 ? totalTableSize - virtualRows[virtualRows.length - 1].end : 0;
  const TABLE_COLUMN_COUNT = 10;

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

  const handleSort = useCallback((field: SortField) => {
    setSortState((prev) => {
      const nextDirection: SortDirection =
        prev.field === field ? (prev.direction === "asc" ? "desc" : "asc") : "asc";
      const next: { field: SortField; direction: SortDirection } = { field, direction: nextDirection };
      void setLibrarySort(next);
      return next;
    });
  }, []);

  const renderSortableHeader = (field: SortField, label: string, align: "left" | "right" = "left") => {
    const isActive = sortField === field;
    const indicator = isActive ? (sortDirection === "asc" ? "^" : "v") : "-";
    const ariaSort = isActive ? (sortDirection === "asc" ? "ascending" : "descending") : "none";

    return (
      <th
        key={field}
        className={`px-2 py-1 ${align === "right" ? "text-right" : "text-left"}`}
        aria-sort={ariaSort}
      >
        <button
          type="button"
          onClick={() => handleSort(field)}
          className={`flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 hover:text-zinc-900 ${align === "right" ? "justify-end" : "justify-start"}`}
        >
          <span>{label}</span>
          <span aria-hidden="true" className="text-[10px] leading-none text-zinc-400">
            {indicator}
          </span>
        </button>
      </th>
    );
  };

  const hasAdvancedFilters = useMemo(() => {
    return (
      [
        priceMin,
        priceMax,
        ttbMin,
        ttbMax,
        pphMin,
        pphMax,
        ocMin,
        mcMin,
        acquiredAfter,
        acquiredBefore,
      ].some((value) => value.trim().length > 0) ||
      requirePrice ||
      requireTTB ||
      requireScore ||
      criticSourceFilter !== "any"
    );
  }, [
    priceMin,
    priceMax,
    ttbMin,
    ttbMax,
    pphMin,
    pphMax,
    ocMin,
    mcMin,
    acquiredAfter,
    acquiredBefore,
    requirePrice,
    requireTTB,
    requireScore,
    criticSourceFilter,
  ]);

  const resetAdvancedFilters = useCallback(() => {
    setPriceMin("");
    setPriceMax("");
    setTtbMin("");
    setTtbMax("");
    setPphMin("");
    setPphMax("");
    setOcMin("");
    setMcMin("");
    setAcquiredAfter("");
    setAcquiredBefore("");
    setRequirePrice(false);
    setRequireTTB(false);
    setRequireScore(false);
    setCriticSourceFilter("any");
  }, []);

  async function clearProfile() {
    if (!confirm("This will delete all local data. Continue?")) return;
    await db.transaction(
      "rw",
      [db.members, db.accounts, db.identities, db.library, db.settings, db.rawgGames, db.sessions],
      async () => {
        await db.members.clear();
        await db.accounts.clear();
        await db.identities.clear();
        await db.library.clear();
        await db.settings.clear();
        await db.rawgGames.clear();
        await db.sessions.clear();
      },
    );
    localStorage.removeItem("seeded-v2");
    location.reload();
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold text-zinc-900">Library</h1>
          <Link to="/explore" className="text-sm font-semibold text-emerald-600 hover:underline">
            Explore more
          </Link>
        </div>
        <ReOnboarding />
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

        <button
          type="button"
          className="btn-ghost relative"
          onClick={() => setAdvancedOpen((open) => !open)}
          title="Toggle advanced filters"
        >
          Filters
          {hasAdvancedFilters && (
            <span className="ml-1 inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          )}
        </button>

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

      {advancedOpen && (
        <div className="card border border-zinc-200 bg-white px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col text-xs font-medium text-zinc-600">
              Price min
              <input
                type="number"
                min="0"
                className="input mt-1"
                value={priceMin}
                onChange={(e) => setPriceMin(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-zinc-600">
              Price max
              <input
                type="number"
                min="0"
                className="input mt-1"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value)}
                placeholder="120"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-zinc-600">
              TTB min (h)
              <input
                type="number"
                min="0"
                className="input mt-1"
                value={ttbMin}
                onChange={(e) => setTtbMin(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-zinc-600">
              TTB max (h)
              <input
                type="number"
                min="0"
                className="input mt-1"
                value={ttbMax}
                onChange={(e) => setTtbMax(e.target.value)}
                placeholder="200"
              />
            </label>

            <label className="flex flex-col text-xs font-medium text-zinc-600">
              Price / hour min
              <input
                type="number"
                min="0"
                className="input mt-1"
                value={pphMin}
                onChange={(e) => setPphMin(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-zinc-600">
              Price / hour max
              <input
                type="number"
                min="0"
                className="input mt-1"
                value={pphMax}
                onChange={(e) => setPphMax(e.target.value)}
                placeholder="10"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-zinc-600">
              OpenCritic min
              <input
                type="number"
                min="0"
                max="100"
                className="input mt-1"
                value={ocMin}
                onChange={(e) => setOcMin(e.target.value)}
                placeholder="75"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-zinc-600">
              Metacritic min
              <input
                type="number"
                min="0"
                max="100"
                className="input mt-1"
                value={mcMin}
                onChange={(e) => setMcMin(e.target.value)}
                placeholder="80"
              />
            </label>

            <label className="flex flex-col text-xs font-medium text-zinc-600">
              Critic source
              <select
                className="select mt-1"
                value={criticSourceFilter}
                onChange={(e) => setCriticSourceFilter(e.target.value as CriticSourceFilter)}
              >
                <option value="any">Any</option>
                <option value="metacritic">Metacritic only</option>
                <option value="opencritic">OpenCritic only</option>
                <option value="rawg">RAWG fallback</option>
                <option value="none">No critic score</option>
              </select>
            </label>
            <label className="flex flex-col text-xs font-medium text-zinc-600">
              Acquired after
              <input
                type="date"
                className="input mt-1"
                value={acquiredAfter}
                onChange={(e) => setAcquiredAfter(e.target.value)}
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-zinc-600">
              Acquired before
              <input
                type="date"
                className="input mt-1"
                value={acquiredBefore}
                onChange={(e) => setAcquiredBefore(e.target.value)}
              />
            </label>
            <div className="hidden lg:block" aria-hidden="true" />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-600">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={requirePrice}
                onChange={(e) => setRequirePrice(e.target.checked)}
              />
              Must include price
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={requireTTB}
                onChange={(e) => setRequireTTB(e.target.checked)}
              />
              Must include TTB
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={requireScore}
                onChange={(e) => setRequireScore(e.target.checked)}
              />
              Must include critic score
            </label>
          </div>

          <div className="mt-4 flex justify-end border-t border-zinc-200 pt-3">
            <button type="button" className="btn-ghost" onClick={resetAdvancedFilters}>
              Reset advanced filters
            </button>
          </div>
        </div>
      )}

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
            <CardGroup
              key={g.identityId}
              group={g}
              onEdit={setEditing}
              expandedId={openId}
              onToggle={toggleDetails}
              nowPlayingAppId={nowPlaying?.appId ?? null}
              rawgEnabled={rawgEnabled}
              steamPersonaName={steamPersona}
            />
          ))}
          {grouped.length === 0 && (
            <div className="text-sm text-zinc-500">Nothing to show. Try changing filters or import.</div>
          )}
        </div>
      )}

      {/* Table */}
      {view === "table" && (
        <div ref={tableContainerRef} className="card overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                {renderSortableHeader("title", "Title")}
                {renderSortableHeader("platform", "Platform")}
                {renderSortableHeader("status", "Status")}
                {renderSortableHeader("price", "Price", "right")}
                {renderSortableHeader("ttb", "TTB (h)", "right")}
                {renderSortableHeader("pph", "Price/h", "right")}
                {renderSortableHeader("oc", "OC", "right")}
                {renderSortableHeader("mc", "MC", "right")}
                {renderSortableHeader("acquired", "Acquired")}
                <th className="px-2 py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_COLUMN_COUNT} className="px-2 py-3 text-center text-sm text-zinc-500">
                    Nothing to show. Try changing filters or import some data.
                  </td>
                </tr>
              ) : (
                <>
                  {tablePaddingTop > 0 && (
                    <tr style={{ height: tablePaddingTop }}>
                      <td colSpan={TABLE_COLUMN_COUNT} />
                    </tr>
                  )}
                  {virtualRows.map((virtualRow) => {
                    const row = tableRows[virtualRow.index];
                    return (
                      <tr key={row.id} data-index={virtualRow.index}>
                        <td className="px-2 py-1">{row.identity?.title ?? "-"}</td>
                        <td className="px-2 py-1">{row.identity?.platform ?? "-"}</td>
                        <td className="px-2 py-1">{row.status}</td>
                        <td className="px-2 py-1 text-right">
                          {row.priceTRY != null
                            ? `${formatCurrency(row.currencyCode)} ${row.priceTRY}`
                            : "-"}
                        </td>
                        <td className="px-2 py-1 text-right">{row.ttbMedianMainH ?? "-"}</td>
                        <td className="px-2 py-1 text-right">
                          {(() => {
                            const pph = pricePerHour(row.priceTRY, row.ttbMedianMainH);
                            if (pph == null) return "-";
                            const sym = formatCurrency(row.currencyCode);
                            return `${sym} ${pph}`;
                          })()}
                        </td>
                        <td className="px-2 py-1 text-right">{row.identity?.ocScore ?? row.ocScore ?? "-"}</td>
                        <td className="px-2 py-1 text-right">{row.identity?.mcScore ?? row.mcScore ?? "-"}</td>
                        <td className="px-2 py-1">{row.acquiredAt ?? "-"}</td>
                        <td className="px-2 py-1">
                          <button className="btn-ghost" onClick={() => setEditing(row)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {tablePaddingBottom > 0 && (
                    <tr style={{ height: tablePaddingBottom }}>
                      <td colSpan={TABLE_COLUMN_COUNT} />
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}


      {/* Import Wizard */}
      <Suspense fallback={null}>
        <ImportWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onImported={loadRows}
        />
      </Suspense>

      {/* Editor */}
      <Editor row={editing} onClose={() => setEditing(null)} onNotify={showToast} />
    </div>
    {toast && (
      <div className="fixed bottom-4 right-4 z-50 rounded-md bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
        {toast}
      </div>
    )}
    {/* Inline details are rendered within each card; no Drawer */}
  </>
);
}

/** ---------- Cards (grouped by Identity) ---------- */
function CardGroup({ group, onEdit, expandedId, onToggle, nowPlayingAppId, rawgEnabled, steamPersonaName }: {
  group: { identityId: string; identity?: Identity; entries: Row[] };
  onEdit: (r: Row) => void;
  expandedId: string | null;
  onToggle: (identityId: string) => void;
  nowPlayingAppId: number | null;
  rawgEnabled: boolean;
  steamPersonaName: string | null;
}) {
  const identity = group.identity;
  const isNowPlaying = identity?.appid != null && nowPlayingAppId === identity.appid;
  const [rawgDetail, setRawgDetail] = useState<RawgGameCache | null>(null);
  const [prefetchRawg, setPrefetchRawg] = useState(false);
  const prefetchTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const title = identity?.title;
    if (!title) {
      setRawgDetail(null);
      return;
    }
    void getCachedRawgDetail(title).then((cached) => {
      if (!cancelled && cached) {
        setRawgDetail(cached);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [identity?.title]);

  useEffect(() => {
    if (!prefetchRawg || !identity?.title || !rawgEnabled) return;
    let cancelled = false;
    void ensureRawgDetail(identity.title).then((detail) => {
      if (!cancelled) {
        setRawgDetail(detail);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [prefetchRawg, identity?.title, rawgEnabled]);

  useEffect(() => {
    return () => {
      if (prefetchTimer.current) {
        window.clearTimeout(prefetchTimer.current);
        prefetchTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!rawgEnabled && prefetchRawg) {
      setPrefetchRawg(false);
    }
  }, [rawgEnabled, prefetchRawg]);

  const isExpanded = identity?.id != null && expandedId === identity.id;

  const schedulePrefetch = useCallback(() => {
    if (!identity?.id || !rawgEnabled) return;
    if (prefetchTimer.current) {
      window.clearTimeout(prefetchTimer.current);
    }
    prefetchTimer.current = window.setTimeout(() => {
      prefetchGameDetailsLazy(identity.id);
      prefetchTimer.current = null;
    }, 200);
  }, [identity?.id, rawgEnabled]);

  const cancelPrefetch = useCallback(() => {
    if (prefetchTimer.current) {
      window.clearTimeout(prefetchTimer.current);
      prefetchTimer.current = null;
    }
  }, []);

  const triggerToggle = useCallback(() => {
    if (!identity?.id) return;
    if (!isExpanded) {
      if (rawgEnabled) {
        setPrefetchRawg(true);
        schedulePrefetch();
      } else {
        setPrefetchRawg(false);
      }
    }
    onToggle(identity.id);
  }, [identity?.id, isExpanded, onToggle, schedulePrefetch, rawgEnabled]);

  const handlePrefetchHint = useCallback(() => {
    if (!identity?.id || isExpanded) return;
    if (rawgEnabled) {
      setPrefetchRawg(true);
      schedulePrefetch();
    } else {
      setPrefetchRawg(false);
    }
  }, [identity?.id, isExpanded, rawgEnabled, schedulePrefetch]);

  const handleHeaderClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      cancelPrefetch();
      triggerToggle();
    },
    [cancelPrefetch, triggerToggle],
  );

  const handleHeaderKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        cancelPrefetch();
        triggerToggle();
      }
    },
    [cancelPrefetch, triggerToggle],
  );

  const best = pickBestEntry(group.entries);
  const ttbValue = best.identity?.ttbMedianMainH ?? best.ttbMedianMainH ?? null;
  const ttbSource = best.identity?.ttbSource;
  const ttbSourceLabel = (() => {
    switch (ttbSource) {
      case "hltb":
      case "hltb-cache":
      case "hltb-local":
      case "html":
        return "HLTB";
      case "igdb":
        return "IGDB";
      case "rawg":
        return "RAWG";
      case "manual":
        return "Manual";
      default:
        return undefined;
    }
  })();
  const pph = pricePerHour(best.priceTRY, ttbValue ?? undefined);

  const platformLabel = identity?.platform;
  const storeId = inferStore(
    { identity, account: best.account, services: best.services },
    rawgDetail?.stores,
  );
  const storeBadge = storeId ? { id: storeId, ...STORE_BADGE_DETAILS[storeId] } : null;
  const title = identity?.title ?? "Untitled";

  const currencyLabel = formatCurrency(best.currencyCode);
  const genreLine = rawgDetail?.genres?.length ? rawgDetail.genres.slice(0, 3).join(", ") : null;
  const storeLine = rawgDetail?.stores?.length
    ? rawgDetail.stores.slice(0, 3).map((s) => s.name).join(", ")
    : null;
  const ocValue = best.identity?.ocScore ?? best.ocScore ?? null;
  const mcValue = best.identity?.mcScore ?? best.mcScore ?? null;
  const criticSource = best.identity?.criticScoreSource ?? null;
  const appid = identity?.appid ?? null;
  const steamStoreUrl = appid ? `https://store.steampowered.com/app/${appid}/` : null;
  const isInstalled = Boolean(best.installed ?? best.installDir ?? best.installPath);
  const primaryActionHref =
    appid != null ? (isInstalled ? `steam://run/${appid}` : `steam://install/${appid}`) : null;
  const scoreInfo = (() => {
    if (mcValue != null) {
      return {
        value: mcValue,
        label: "MC",
        className: "inline-block text-xs rounded bg-zinc-200 px-2 py-0.5 text-zinc-700",
        title: "Metacritic (vendor)",
        aria: "Metacritic score (vendor)",
      };
    }
    if (ocValue != null) {
      const source = criticSource ?? "opencritic";
      if (source === "rawg") {
        return {
          value: ocValue,
          label: "RAWG",
          className: "inline-block text-xs rounded bg-indigo-600 px-2 py-0.5 text-white",
          title: "RAWG aggregated score",
          aria: "RAWG aggregated score",
        };
      }
      return {
        value: ocValue,
        label: "OC",
        className: "inline-block text-xs rounded bg-emerald-600 px-2 py-0.5 text-white",
        title: "OpenCritic score",
        aria: "OpenCritic score",
      };
    }
    return null;
  })();

  const metaChipClass =
    "inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-600 shadow-sm";
  const entriesLabel = group.entries.length === 1 ? "entry" : "entries";

  const baseAccountLabel =
    best.account?.label ??
    (best.accountId && best.accountId.toLowerCase() === "steam" ? "Steam" : undefined) ??
    (best.services?.some((svc) => svc.toLowerCase() === "steam") ? "Steam" : undefined) ??
    "-";
  const accountLabel =
    baseAccountLabel === "Steam" && steamPersonaName
      ? `${baseAccountLabel} (${steamPersonaName})`
      : baseAccountLabel;
  const memberLabel =
    best.member?.name ?? (best.memberId && best.memberId !== "everyone" ? best.memberId : "Everyone");
  const formatPlaytime = useCallback((minutes?: number | null) => {
    if (minutes == null || !Number.isFinite(minutes)) return null;
    const hours = Math.round((Number(minutes) / 60) * 10) / 10;
    return `${hours}h`;
  }, []);
  const totalPlaytimeLabel = formatPlaytime(best.playtimeForeverMin ?? null);
  const recentPlaytimeLabel = formatPlaytime(best.playtimeTwoWeeksMin ?? null);
  const lastPlayedLabel = best.lastPlayedAtISO ? new Date(best.lastPlayedAtISO).toLocaleDateString() : null;

  return (
    <article
      className={clsx(
        "card library-card relative overflow-hidden rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm transition focus-within:ring-2 focus-within:ring-emerald-500",
        isExpanded ? "ring-1 ring-emerald-500/40" : "hover:border-emerald-200",
      )}
      data-expanded={isExpanded || undefined}
    >
      <div
        className="group relative grid cursor-pointer items-start gap-4 sm:grid-cols-[108px_1fr]"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onMouseEnter={handlePrefetchHint}
        onFocus={handlePrefetchHint}
        onMouseLeave={cancelPrefetch}
        onBlur={cancelPrefetch}
        onClick={handleHeaderClick}
        onKeyDown={handleHeaderKeyDown}
        aria-label={`Toggle details for ${title}`}
      >
        <div className="overflow-hidden rounded-2xl border border-white/70 bg-white shadow-md ring-1 ring-black/5 transition group-hover:ring-emerald-200">
          <GameCover identity={identity} size="lg" className="!w-24 sm:!w-28" />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-500">
                Library entry
              </span>
              <h3 className="truncate text-lg font-semibold text-zinc-900">{title}</h3>
              {genreLine ? <p className="text-xs text-zinc-500">{genreLine}</p> : null}
            </div>
            <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              {group.entries.length} {entriesLabel}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isNowPlaying ? (
              <span
                className={clsx(metaChipClass, "border-none bg-emerald-600 text-white")}
                aria-label="Currently playing on Steam"
              >
                Now Playing
              </span>
            ) : null}
            <span className={metaChipClass}>Status {best.status}</span>
            <span className={metaChipClass}>
              {currencyLabel} {best.priceTRY ?? "-"}
            </span>
            <span className={metaChipClass}>
              {ttbSourceLabel ? `TTB ${ttbSourceLabel}` : "TTB"}{" "}
              {ttbValue != null ? `${ttbValue}h` : "-"}
            </span>
            <span className={metaChipClass}>
              {currencyLabel}/h {pph ?? "-"}
            </span>
            {totalPlaytimeLabel ? (
              <span className={metaChipClass}>Playtime {totalPlaytimeLabel}</span>
            ) : null}
            {recentPlaytimeLabel ? (
              <span className={metaChipClass}>Last 2w {recentPlaytimeLabel}</span>
            ) : null}
            {lastPlayedLabel ? <span className={metaChipClass}>Last {lastPlayedLabel}</span> : null}
            {platformLabel ? <span className={metaChipClass}>{platformLabel}</span> : null}
            {storeBadge ? (
              <span
                className={clsx(
                  metaChipClass,
                  `store-badge store-badge--${storeBadge.id}`,
                  "border-none bg-emerald-600/10 text-emerald-700",
                )}
                title={storeBadge.label}
                aria-label={`${storeBadge.label} store`}
              >
                {storeBadge.badge}
              </span>
            ) : null}
            {scoreInfo ? (
              <span
                className={clsx(
                  metaChipClass,
                  "border-none text-white",
                  scoreInfo.label === "MC"
                    ? "bg-blue-600"
                    : scoreInfo.label === "OC"
                      ? "bg-emerald-600"
                      : "bg-indigo-600",
                )}
                title={scoreInfo.title}
                aria-label={scoreInfo.aria}
              >
                {scoreInfo.label}: {scoreInfo.value}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>Account {accountLabel}</span>
            <span>Member {memberLabel}</span>
            {storeLine ? <span className="truncate">Stores {storeLine}</span> : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <span className="text-[11px] text-zinc-400">{rawgEnabled ? "Press Enter or click to view details" : "RAWG disabled: limited media"}</span>
            <div className="flex flex-wrap items-center gap-2">
              {primaryActionHref ? (
                <a
                  href={primaryActionHref}
                  className="btn h-8 rounded-full px-4 text-xs font-semibold"
                  onClick={(event) => event.stopPropagation()}
                >
                  {isInstalled ? "Play" : "Install"}
                </a>
              ) : null}
              {steamStoreUrl ? (
                <a
                  href={steamStoreUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-ghost h-8 rounded-full px-4 text-xs font-semibold"
                  onClick={(event) => event.stopPropagation()}
                >
                  Open Store
                </a>
              ) : null}
              <button
                className="btn h-8 rounded-full px-4 text-xs font-semibold"
                onClick={(event) => {
                  event.stopPropagation();
                  setPrefetchRawg(rawgEnabled);
                  onEdit(best);
                }}
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      </div>

      {isExpanded && identity?.id ? (
        <div
          className="mt-4 rounded-2xl border border-emerald-100 bg-white/60 p-2 sm:p-3"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <UIErrorBoundary title="Game details failed">
            <Suspense fallback={<InlineDetailsFallback />}>
              <GameDetails identityId={identity.id} variant="compact" />
            </Suspense>
          </UIErrorBoundary>
        </div>
      ) : null}

      <span
        aria-hidden="true"
        className={clsx(
          "pointer-events-none absolute right-2 top-2 hidden text-lg text-zinc-300 transition-transform sm:block",
          isExpanded ? "rotate-180" : "",
        )}
      >
        ▾
      </span>

    </article>
  );
}
function Editor({
  row,
  onClose,
  onNotify,
}: {
  row: Row | null;
  onClose: () => void;
  onNotify: (message: string) => void;
}) {
  const open = Boolean(row);
  const current = row ?? null;

  const { enabled: igdbOn, fetchMeta } = useIGDB();
  const { enabled: hltbOn, fetchTTB } = useHLTB();

  const [status, setStatus] = useState<Status>(current?.status ?? "Backlog");
  const [price, setPrice] = useState<number>(current?.priceTRY ?? 0);
  const [currency, setCurrency] = useState<string>(current?.currencyCode ?? "TRY");
  const [ttb, setTtb] = useState<number | null>(current?.ttbMedianMainH ?? null);
  const [ocScore, setOcScore] = useState<number | null>(current?.identity?.ocScore ?? current?.ocScore ?? null);
  const [mcScore, setMcScore] = useState<number | null>(current?.identity?.mcScore ?? current?.mcScore ?? null);
  const currentAppid = current?.identity?.appid ?? null;
  const [appidInput, setAppidInput] = useState<string>(currentAppid ? String(currentAppid) : "");

  const [busyTTB, setBusyTTB] = useState(false);
  const [busyPrice, setBusyPrice] = useState(false);
  const [busyOC, setBusyOC] = useState(false);
  const [busyMC, setBusyMC] = useState(false);
  const [busySteamPersonal, setBusySteamPersonal] = useState(false);

  useEffect(() => {
    if (!current) return;
    setStatus(current.status);
    setPrice(current.priceTRY ?? 0);
    setCurrency(current.currencyCode ?? "TRY");
    setTtb(current.ttbMedianMainH ?? null);
    setOcScore(current.identity?.ocScore ?? current.ocScore ?? null);
    setMcScore(current.identity?.mcScore ?? current.mcScore ?? null);
  }, [current?.id]);

  useEffect(() => {
    setAppidInput(currentAppid ? String(currentAppid) : "");
  }, [currentAppid]);

  if (!open || !current) return null;

  const openCriticPref = typeof window !== "undefined" ? localStorage.getItem("oc_enabled") === "1" : false;
  const openCriticAvailable = flags.openCriticEnabled || openCriticPref;
  const ocDisabled = !isTauri || !openCriticAvailable || busyOC;

  const hltbDisabled = !hltbOn || busyTTB;
  const hltbTooltip = (() => {
    if (!hltbOn) return "Enable HowLongToBeat integration in settings";
    if (isTauri) return "Fetch HowLongToBeat (local dataset, desktop adds live fetch)";
    return "Fetch HowLongToBeat (local dataset only)";
  })();

  const currencyLabel = (code: string | null | undefined) => formatCurrency(code);

  const currencySymbol = currencyLabel(currency) ?? currency ?? "TRY";
  const hasPrice = Number.isFinite(price);
  const priceDisplay = hasPrice
    ? `${currencySymbol} ${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : "—";
  const pricePerHourValue = pricePerHour(price, ttb ?? undefined);
  const pricePerHourDisplay =
    pricePerHourValue != null ? `${currencySymbol} ${pricePerHourValue}` : "—";
  const hoursPerCurrencyValue =
    price > 0 && ttb != null && ttb > 0 ? ttb / price : null;
  const hoursPerCurrencyDisplay =
    hoursPerCurrencyValue != null
      ? `${hoursPerCurrencyValue.toFixed(2)} h / ${currencySymbol}`
      : "—";
  const ttbDisplay = ttb != null ? `${ttb} h` : "—";
  const criticDisplay =
    ocScore != null
      ? `OpenCritic ${ocScore}`
      : mcScore != null
        ? `Metacritic ${mcScore}`
        : "—";
  const servicesLine = current.services?.length ? current.services.join(", ") : null;
  const accountLabel = current.account?.label ?? "Unassigned";
  const memberLabel = current.member?.name ?? "Unassigned";
  const statusDisplay = status;
  const appidDisplay = currentAppid ?? "—";

  const updateIdentity = async (values: Partial<Identity>) => {
    if (!current.identity?.id) return;
    await db.identities.update(current.identity.id, values as any);
  };

  const inspectorRawTitle = current.identity?.title ?? "";
  const inspectorNormalizedTitle = inspectorRawTitle ? normalizeTitle(inspectorRawTitle) : "";
  const inspectorMcKey = inspectorRawTitle
    ? mcKey(inspectorRawTitle, current.identity?.platform ?? undefined, undefined)
    : "";

  const handleFetchOpenCritic = async () => {
    const title = current.identity?.title?.trim();
    if (!title) {
      onNotify("Missing title to fetch OpenCritic score.");
      return;
    }
    setBusyOC(true);
    try {
      const value = await fetchOpenCriticScore(title);
      const rounded = value != null ? Math.round(value) : null;
      if (rounded == null) {
        onNotify("OpenCritic: not found after retries.");
        return;
      }
      setOcScore(rounded);
      setMcScore(null);
      await updateIdentity({ ocScore: rounded, mcScore: null, criticScoreSource: "opencritic" });
      await db.library.update(current.id, { ocScore: rounded, mcScore: null } as any);
      onNotify(`OpenCritic score updated to ${rounded}.`);
    } catch (err: any) {
      onNotify(err?.message || "OpenCritic fetch failed.");
    } finally {
      setBusyOC(false);
    }
  };

  const handleFetchMetacritic = async () => {
    const title = current.identity?.title?.trim();
    if (!title) {
      onNotify("Missing title to lookup Metacritic.");
      return;
    }
    setBusyMC(true);
    try {
      await loadMCIndex();
      const key = mcKey(title, current.identity?.platform ?? undefined, undefined);
      const entry = await getMCEntry(key);
      if (!entry?.score) {
        onNotify("Metacritic (vendor): not found.");
        return;
      }
      const rounded = Math.round(entry.score);
      setMcScore(rounded);
      setOcScore(null);
      await updateIdentity({ mcScore: rounded, ocScore: null, criticScoreSource: "metacritic" });
      await db.library.update(current.id, { mcScore: rounded, ocScore: null } as any);
      onNotify(`Metacritic (vendor) score set to ${rounded}.`);
    } catch (err: any) {
      onNotify(err?.message || "Metacritic vendor lookup failed.");
    } finally {
      setBusyMC(false);
    }
  };

  const handleFetchSteamPersonal = async () => {
    if (!isTauri) {
      onNotify("Steam data fetch requires the desktop app.");
      return;
    }
    if (!currentAppid) {
      onNotify("Add a Steam app id before fetching personal data.");
      return;
    }
    setBusySteamPersonal(true);
    try {
      const storedId = await getSetting<string>("steam.myId");
      if (!storedId) {
        onNotify("Save your Steam ID in Settings first.");
        return;
      }
      const { id: normalizedId } = await ensureSteamId(storedId);
      if (normalizedId !== storedId) {
        await setSetting("steam.myId", normalizedId);
      }
      resetSteamCacheLazy(normalizedId);
      const ownedGames = await getOwnedGames(normalizedId, true);
      const ownedEntry = ownedGames.find((game) => game.appId === currentAppid);
      if (!ownedEntry) {
        onNotify("No personal Steam data found for this game (not owned or profile private).");
        return;
      }
      const timestamp = new Date().toISOString();
      const ownedRow: SteamOwnedRow = {
        steamid: normalizedId,
        appid: currentAppid,
        name: ownedEntry.name,
        playtimeForeverMin: ownedEntry.playtimeForeverMin,
        playtimeTwoWeeksMin: ownedEntry.playtimeTwoWeeksMin ?? null,
        lastPlayedAt: ownedEntry.lastPlayedAt ?? null,
        hasVisibleStats: ownedEntry.hasVisibleStats,
        iconHash: ownedEntry.iconHash ?? null,
        logoHash: ownedEntry.logoHash ?? null,
        playtimeWindowsMin: ownedEntry.playtimeWindowsMin ?? null,
        playtimeMacMin: ownedEntry.playtimeMacMin ?? null,
        playtimeLinuxMin: ownedEntry.playtimeLinuxMin ?? null,
        contentDescriptorIds: ownedEntry.contentDescriptorIds ?? null,
        lastFetchedISO: timestamp,
      };
      await db.steamOwned.put(ownedRow);

      let achievementsSummary: { unlocked: number; total: number } | null = null;
      if (ownedEntry.hasVisibleStats) {
        try {
          const achievements = await getPlayerAchievements(normalizedId, currentAppid);
          if (achievements) {
            achievementsSummary = { unlocked: achievements.unlocked, total: achievements.total };
            await upsertSteamAchievementsRow({
              steamid: normalizedId,
              appid: currentAppid,
              unlocked: achievements.unlocked,
              total: achievements.total,
              items: achievements.items.map((item) => ({
                apiName: item.apiName,
                achieved: item.achieved,
                unlockTime: item.unlockTime ?? null,
              })),
              lastFetchedISO: achievements.lastFetchedISO ?? timestamp,
            });
          }
        } catch (_err) {
          // Ignore achievement fetch failures; status heuristics fall back to playtime.
        }
      }

      const services = new Set(current.services ?? []);
      services.add("Steam");
      const lastPlayedISO =
        ownedEntry.lastPlayedAt && Number.isFinite(ownedEntry.lastPlayedAt)
          ? new Date(ownedEntry.lastPlayedAt * 1000).toISOString()
          : null;
      const libraryUpdates: any = {
        playtimeForeverMin: ownedEntry.playtimeForeverMin,
        playtimeTwoWeeksMin: ownedEntry.playtimeTwoWeeksMin ?? null,
        lastPlayedAtISO: lastPlayedISO,
        services: Array.from(services),
        source: "steam",
      };
      if (!current.accountId || current.accountId.toLowerCase() !== "steam") {
        libraryUpdates.accountId = "steam";
      }
      if (ownedEntry.playtimeForeverMin > 0) {
        libraryUpdates.installed = true;
      }
      const ttbHours = current.identity?.ttbMedianMainH ?? current.ttbMedianMainH ?? null;
      const playtimeHours = ownedEntry.playtimeForeverMin / 60;
      const completedByAchievements =
        achievementsSummary != null && achievementsSummary.total > 0 && achievementsSummary.unlocked >= achievementsSummary.total;
      const completedByTtb = ttbHours != null && playtimeHours >= ttbHours;
      const hasMeaningfulPlay = ownedEntry.playtimeForeverMin >= 60;

      let statusCandidate: Status | null = "Owned";
      if (completedByAchievements || completedByTtb) {
        statusCandidate = "Beaten";
      } else if (hasMeaningfulPlay) {
        statusCandidate = "Playing";
      }

      let nextStatus = current.status;
      if (statusCandidate === "Beaten" && current.status !== "Beaten" && current.status !== "Abandoned") {
        nextStatus = "Beaten";
      } else if (
        statusCandidate === "Playing" &&
        (current.status === "Backlog" || current.status === "Owned" || current.status === "Wishlist")
      ) {
        nextStatus = "Playing";
      } else if (
        statusCandidate === "Owned" &&
        (current.status === "Backlog" || current.status === "Wishlist")
      ) {
        nextStatus = "Owned";
      }

      const statusChanged = nextStatus !== current.status;
      if (statusChanged) {
        libraryUpdates.status = nextStatus;
      }

      await db.library.update(current.id, libraryUpdates);
      if (statusChanged) {
        setStatus(nextStatus);
      }

      try {
        const recentGames = await getRecentlyPlayed(normalizedId);
        const recentEntry = recentGames.find((game) => game.appId === currentAppid);
        if (recentEntry) {
          const recentRow: SteamRecentRow = {
            steamid: normalizedId,
            appid: currentAppid,
            name: recentEntry.name,
            playtimeTwoWeeksMin: recentEntry.playtimeTwoWeeksMin ?? null,
            playtimeForeverMin: recentEntry.playtimeForeverMin ?? null,
            lastPlayedAt: recentEntry.lastPlayedAt ?? null,
            iconHash: recentEntry.iconHash ?? null,
            logoHash: recentEntry.logoHash ?? null,
            lastFetchedISO: timestamp,
          };
          await db.steamRecent.put(recentRow);
        }
      } catch (_err) {
        // silently ignore recent fetch errors
      }

      if (current.identity?.id) {
        invalidateGameDetailsLazy(current.identity.id);
        prefetchGameDetailsLazy(current.identity.id);
      }

      window.dispatchEvent(new Event("gt:library-reload"));
      const notifyParts = ["Steam playtime refreshed from your account."];
      if (statusChanged) {
        notifyParts.push(`Status updated to ${nextStatus}.`);
      }
      onNotify(notifyParts.join(" "));
    } catch (err: any) {
      onNotify(err?.message || "Steam personal data fetch failed.");
    } finally {
      setBusySteamPersonal(false);
    }
  };

  const handleFetchHLTB = async () => {
    const title = current.identity?.title?.trim();
    if (!title) {
      onNotify("Missing title to fetch HowLongToBeat.");
      return;
    }
    setBusyTTB(true);
    try {
      const res = await fetchTTB(title, current.identity?.platform ?? undefined);
      const hours = res.mainMedianHours ?? null;
      if (hours != null) {
        setTtb(hours);
        await db.library.update(current.id, { ttbMedianMainH: hours } as any);
        const safeSource = res.source === "off" ? undefined : res.source;
        await updateIdentity({
          ttbMedianMainH: hours,
          ...(safeSource ? { ttbSource: safeSource } : {}),
        });
        onNotify(`HowLongToBeat updated: ${hours}h (source: ${res.source})`);
      } else if (res.source === "off") {
        onNotify("HowLongToBeat is disabled in settings or unavailable in this environment.");
      } else {
        onNotify("HowLongToBeat: not found after available lookups.");
      }
    } catch (err: any) {
      onNotify(err?.message || "HowLongToBeat fetch failed.");
    } finally {
      setBusyTTB(false);
    }
  };

  return (
    <Modal open={open} title={`Edit: ${current.identity?.title ?? "Untitled"}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();

          await db.library.update(current.id, {
            status,
            priceTRY: price,
            currencyCode: currency,
            ttbMedianMainH: ttb ?? undefined,
            ocScore: mcScore != null ? undefined : ocScore ?? undefined,
            mcScore: mcScore ?? undefined,
          } as any);

          let nextSource: Identity["ttbSource"] | undefined = current.identity?.ttbSource;
          if (ttb == null) {
            nextSource = undefined;
          } else if (current.ttbMedianMainH !== ttb) {
            nextSource = "manual";
          }

          const resolvedMc = mcScore ?? null;
          const resolvedOc = resolvedMc != null ? null : ocScore ?? null;
          let nextCriticSource: Identity["criticScoreSource"] | undefined;
          if (resolvedMc != null) {
            nextCriticSource = "metacritic";
          } else if (resolvedOc != null) {
            nextCriticSource =
              current.identity?.criticScoreSource === "rawg" ? "rawg" : "opencritic";
          } else {
            nextCriticSource = undefined;
          }

          await updateIdentity({
            ttbMedianMainH: ttb ?? undefined,
            ttbSource: nextSource,
            ocScore: resolvedOc,
            mcScore: resolvedMc,
            criticScoreSource: nextCriticSource,
          });

          onClose();
          location.reload();
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-zinc-500">Status</label>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {[
                "Backlog",
                "Playing",
                "Beaten",
                "Abandoned",
                "Wishlist",
                "Owned",
              ].map((s) => (
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
              value={ttb ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  setTtb(null);
                  return;
                }
                const next = Number(raw);
                setTtb(Number.isFinite(next) ? next : null);
              }}
            />
          </div>

          <div>
            <label className="text-xs text-zinc-500">OpenCritic Score</label>
            <input
              className="input"
              type="number"
              value={ocScore ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  setOcScore(null);
                  return;
                }
                const next = Number(raw);
                setOcScore(Number.isFinite(next) ? next : null);
              }}
            />
          </div>

          <div>
            <label className="text-xs text-zinc-500">Metacritic Score (vendor)</label>
            <input
              className="input"
              type="number"
              value={mcScore ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  setMcScore(null);
                  return;
                }
                const next = Number(raw);
                setMcScore(Number.isFinite(next) ? next : null);
              }}
            />
          </div>
        </div>
        <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-inner">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-zinc-900">
              {current.identity?.title ?? "Untitled"}
            </h3>
            <p className="text-xs text-zinc-500">
              Platform: {current.identity?.platform ?? "Unassigned"}
            </p>
            <p className="text-xs text-zinc-500">Status: {statusDisplay}</p>
            <p className="text-xs text-zinc-500">
              Account: {accountLabel} / Member: {memberLabel}
            </p>
            {servicesLine ? (
              <p className="text-xs text-zinc-500">Services: {servicesLine}</p>
            ) : null}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-xs text-zinc-500 sm:grid-cols-3">
            <div>
              <dt className="font-semibold text-zinc-600">Price</dt>
              <dd className="text-sm text-zinc-900">{priceDisplay}</dd>
            </div>
            <div>
              <dt className="font-semibold text-zinc-600">Hours / price</dt>
              <dd className="text-sm text-zinc-900">{hoursPerCurrencyDisplay}</dd>
            </div>
            <div>
              <dt className="font-semibold text-zinc-600">TTB median</dt>
              <dd className="text-sm text-zinc-900">{ttbDisplay}</dd>
            </div>
            <div>
              <dt className="font-semibold text-zinc-600">Critic score</dt>
              <dd className="text-sm text-zinc-900">{criticDisplay}</dd>
            </div>
            <div>
              <dt className="font-semibold text-zinc-600">Steam appid</dt>
              <dd className="text-sm text-zinc-900">{appidDisplay}</dd>
            </div>
          </dl>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            className="btn"
            disabled={ocDisabled}
            title={
              !isTauri
                ? "Desktop-only"
                : !openCriticAvailable
                ? "OpenCritic is disabled (feature flag)"
                : "Fetch OpenCritic score"
            }
            onClick={handleFetchOpenCritic}
          >
            Fetch OpenCritic
          </button>

          <button
            type="button"
            className="btn"
            disabled={busyMC}
            title="Fetch Metacritic score from vendor index"
            onClick={handleFetchMetacritic}
          >
            Fetch Metacritic (vendor)
          </button>

          <button
            type="button"
            className="btn"
            disabled={hltbDisabled}
            title={hltbTooltip}
            onClick={handleFetchHLTB}
          >
            Fetch HLTB / TTB
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn"
            disabled={!igdbOn}
            title={!igdbOn ? "IGDB integration disabled" : "Fetch IGDB metadata (mock)"}
            onClick={async () => {
              try {
                const title = current.identity?.title?.trim();
                if (!title) {
                  onNotify("Missing title to fetch IGDB metadata.");
                  return;
                }
                const meta = await fetchMeta(title);
                if (!meta) {
                  onNotify("No IGDB result found.");
                  return;
                }
                await updateIdentity(meta as Partial<Identity>);
                onNotify("IGDB metadata updated.");
              } catch (err: any) {
                onNotify(err?.message || "IGDB fetch failed.");
              }
            }}
          >
            Fetch IGDB
          </button>

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
                if (!currentAppid) {
                  onNotify("This game has no Steam appid.");
                  return;
                }
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
                  onNotify("Steam price: not found after retries.");
                  return;
                }
                setPrice(result.price);
                setCurrency(result.currency);
                await db.library.update(current.id, { priceTRY: result.price, currencyCode: result.currency } as any);
                onNotify("Steam price updated.");
              } catch (err: any) {
                onNotify(err?.message || "Steam price fetch failed.");
              } finally {
                setBusyPrice(false);
              }
            }}
          >
            Fetch Steam Price
      </button>

      <button
        type="button"
        className="btn col-span-2"
        disabled={!isTauri || !currentAppid || busySteamPersonal}
        title={
          !isTauri
            ? "Desktop-only"
            : !currentAppid
            ? "Add a Steam app id first"
            : "Sync playtime and install flags from your Steam account"
        }
        onClick={handleFetchSteamPersonal}
      >
        {busySteamPersonal ? "Fetching Steam playtime..." : "Fetch Steam personal data"}
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
                if (!parsed) {
                  onNotify("Enter a valid appid or Steam app URL.");
                  return;
                }
                if (!current.identity?.id) {
                  onNotify("Missing identity.");
                  return;
                }
                await db.identities.update(current.identity.id, { appid: parsed } as any);
                setAppidInput("");
                onNotify(`Saved appid ${parsed}. You can now fetch price.`);
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
                if (!confirm(`Delete this entry: "${current.identity?.title ?? "Untitled"}"?`)) return;
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

        <DataInspector
          rawTitle={inspectorRawTitle}
          normalizedTitle={inspectorNormalizedTitle}
          identityTitle={current.identity?.title ?? null}
          mcKey={inspectorMcKey}
        />
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

function InlineDetailsFallback() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-1/2 animate-pulse rounded bg-zinc-200" />
      <div className="h-48 w-full animate-pulse rounded bg-zinc-200" />
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-zinc-200" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-200" />
      </div>
    </div>
  );
}



































