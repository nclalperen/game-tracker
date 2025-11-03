import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { listTrending, listUpcoming, listNewReleases } from "@/apis/rawg";
import {
  db,
  type RawgListItem,
  getRawgListRow,
  upsertRawgListRow,
  isRawgListStale,
  pruneRawgLists,
  addWishlistItem,
  removeWishlistItem,
  WISHLIST_SOURCE_USER,
} from "@/db";
import { useWishlistSnapshot } from "@/hooks/useWishlistSnapshot";

const GameDetails = lazy(() => import("../components/details/GameDetails"));

type TabKey = "trending" | "upcoming" | "new";

type ExploreState =
  | { status: "loading"; items: RawgListItem[] }
  | { status: "ready"; items: RawgListItem[]; fetchedAt: string }
  | { status: "error"; items: RawgListItem[]; message: string };

type SuggestedTabConfig = {
  label: string;
  description: string;
};

const TAB_CONFIG: Record<TabKey, SuggestedTabConfig> = {
  trending: {
    label: "Trending",
    description: "Most played and most added games over the last month.",
  },
  upcoming: {
    label: "Upcoming",
    description: "Big releases arriving in the next few months.",
  },
  new: {
    label: "New Releases",
    description: "Fresh launches from the past few weeks.",
  },
};

const FETCHERS: Record<TabKey, (page: number) => Promise<any>> = {
  trending: listTrending,
  upcoming: listUpcoming,
  new: listNewReleases,
};

type IdentityMap = Map<number, string>;
type Notice = { kind: "info" | "error"; message: string };

function prefetchGameDetailsLazy(identityId: string) {
  void import("../components/details/GameDetails")
    .then((mod) => {
      if (typeof mod.prefetchGameDetails === "function") {
        mod.prefetchGameDetails(identityId);
      }
    })
    .catch(() => {});
}

function mapResultToItem(result: any): RawgListItem {
  const genres = Array.isArray(result.genres) ? result.genres.map((g: any) => g?.name).filter(Boolean) : [];
  const platforms = Array.isArray(result.platforms)
    ? result.platforms
        .map((entry: any) => entry?.platform?.name ?? entry?.name)
        .filter((name: unknown): name is string => typeof name === "string" && name.length > 0)
    : [];
  const stores = Array.isArray(result.stores)
    ? result.stores
        .map((entry: any) => {
          const id = entry?.store?.id ?? entry?.id ?? 0;
          const name = entry?.store?.name ?? entry?.name ?? "";
          const domain = entry?.store?.domain ?? entry?.domain ?? null;
          const url = typeof entry?.url === "string" ? entry.url : null;
          if (!name) return null;
          return {
            id,
            name,
            domain,
            url,
          };
        })
        .filter((value: unknown): value is { id: number; name: string; domain: string | null; url: string | null } => Boolean(value))
    : [];
  return {
    id: result.id,
    slug: result.slug,
    title: result.name ?? result.slug ?? "Untitled",
    backgroundImage: result.background_image ?? result.backgroundImage ?? null,
    genres,
    platforms,
    stores,
    metacritic: typeof result.metacritic === "number" ? result.metacritic : null,
  };
}

function extractSteamAppId(stores: RawgListItem["stores"]): number | null {
  for (const store of stores ?? []) {
    const isSteamStore = store.id === 1 || (store.name ?? "").toLowerCase().includes("steam");
    if (!isSteamStore) continue;
    const source = store.url ?? "";
    const match = source.match(/\/app\/(\d+)/i);
    if (match) {
      const appid = Number(match[1]);
      if (Number.isFinite(appid) && appid > 0) {
        return appid;
      }
    }
  }
  return null;
}

function fallbackManualAppId(rawgId: number): number {
  const base = Math.abs(rawgId);
  return base > 0 ? -base : -1;
}

export default function ExplorePage(): JSX.Element {
  const [tab, setTab] = useState<TabKey>("trending");
  const [state, setState] = useState<ExploreState>({ status: "loading", items: [] });
  const [identityMap, setIdentityMap] = useState<IdentityMap>(new Map());
  const [expandedIdentityId, setExpandedIdentityId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const { manual: manualWishlistAppIds, all: allWishlistAppIds, refresh: refreshWishlist } =
    useWishlistSnapshot((message) => setNotice({ kind: "error", message }));
  const [pendingWishlistAppIds, setPendingWishlistAppIds] = useState<Set<number>>(new Set());

  const readyKey = useMemo(() => {
    if (state.status !== "ready") return "";
    return state.items.map((item) => item.id).join(",");
  }, [state]);

  useEffect(() => {
    let cancelled = false;

    const key = `${tab}:1`;
    (async () => {
      const cached = await getRawgListRow(key);
      if (cancelled) return;

      if (cached && !isRawgListStale(cached)) {
        setState({ status: "ready", items: cached.items, fetchedAt: cached.fetchedAtISO });
        return;
      }

      setState((prev) => ({ status: "loading", items: prev.items }));
      try {
        const response = await FETCHERS[tab](1);
        const results = Array.isArray(response?.results) ? response.results : [];
        const items = results.slice(0, 24).map(mapResultToItem);
        const row = {
          key,
          page: 1,
          items,
          fetchedAtISO: new Date().toISOString(),
        };
        await upsertRawgListRow(row);
        void pruneRawgLists();
        if (!cancelled) {
          setState({ status: "ready", items, fetchedAt: row.fetchedAtISO });
        }
      } catch (error: any) {
        if (!cancelled) {
          setState((prev) => ({
            status: "error",
            items: prev.items,
            message: error?.message ?? "Failed to load RAWG list.",
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    if (state.status !== "ready") {
      setIdentityMap(new Map());
      return;
    }

    const ids = state.items.map((item) => item.id);
    if (!ids.length) {
      setIdentityMap(new Map());
      return;
    }

    let cancelled = false;
    (async () => {
      const identities = await db.identities.where("rawgId").anyOf(ids).toArray();
      if (cancelled) return;
      const map: IdentityMap = new Map();
      identities.forEach((identity) => {
        if (typeof identity.rawgId === "number") {
          map.set(identity.rawgId, identity.id);
        }
      });
      setIdentityMap(map);
    })();

    return () => {
      cancelled = true;
    };
  }, [readyKey, state.status]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.kind === "error" ? 5000 : 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const fetchedLabel = useMemo(() => {
    if (state.status !== "ready") return null;
    const date = new Date(state.fetchedAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
  }, [state]);

  const handleWishlistToggle = useCallback(
    async (rawgItem: RawgListItem, targetAppId: number, steamAppId: number | null) => {
      if (pendingWishlistAppIds.has(targetAppId)) return;
      setPendingWishlistAppIds((prev) => {
        const next = new Set(prev);
        next.add(targetAppId);
        return next;
      });
      try {
        if (manualWishlistAppIds.has(targetAppId)) {
          await removeWishlistItem(targetAppId, WISHLIST_SOURCE_USER);
        } else {
          await addWishlistItem({
            appid: targetAppId,
            title: rawgItem.title,
            platform: rawgItem.platforms[0] ?? null,
            currency: null,
            initial: null,
            final: null,
            discountPercent: null,
            saleEndISO: null,
          });
          if (steamAppId == null) {
            setNotice({
              kind: "info",
              message: "Saved to wishlist (manual entry). Link a Steam app id later to track prices.",
            });
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : typeof err === "string" ? err : "Wishlist update failed.";
        setNotice({ kind: "error", message });
      } finally {
        setPendingWishlistAppIds((prev) => {
          const next = new Set(prev);
          next.delete(targetAppId);
          return next;
        });
        void refreshWishlist();
      }
    },
    [manualWishlistAppIds, pendingWishlistAppIds, refreshWishlist],
  );

  const items = state.status === "ready" ? state.items : state.items ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Explore Games</h1>
          <p className="text-sm text-zinc-500">{TAB_CONFIG[tab].description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(TAB_CONFIG) as TabKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={clsx(
                "rounded-full px-4 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                key === tab
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-white text-emerald-600 hover:bg-emerald-50 border border-emerald-100",
              )}
              onClick={() => {
                setExpandedIdentityId(null);
                setTab(key);
              }}
            >
              {TAB_CONFIG[key].label}
            </button>
          ))}
        </div>
      </header>

      {notice ? (
        <div
          className={clsx(
            "rounded-2xl border px-4 py-3 text-sm",
            notice.kind === "error"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700",
          )}
        >
          {notice.message}
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {state.message}
        </div>
      ) : null}

      {state.status === "loading" && !items.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="space-y-3 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm">
              <div className="aspect-[16/10] rounded-2xl bg-zinc-200 animate-pulse" />
              <div className="h-4 w-2/3 rounded bg-zinc-200 animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-zinc-200 animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const identityId = identityMap.get(item.id) ?? null;
            const isExpanded = identityId != null && expandedIdentityId === identityId;
            const steamAppId = extractSteamAppId(item.stores);
            const manualAppId = steamAppId ?? fallbackManualAppId(item.id);
            const manualWishlisted = manualWishlistAppIds.has(manualAppId);
            const anyWishlisted =
              steamAppId != null ? allWishlistAppIds.has(steamAppId) || manualWishlisted : manualWishlisted;
            const pendingWishlist = pendingWishlistAppIds.has(manualAppId);
            const wishlistLabel = pendingWishlist
              ? "Saving..."
              : manualWishlisted
                ? "Wishlisted"
                : anyWishlisted
                  ? "On Steam"
                  : "Wishlist";
            const buttonDisabled =
              pendingWishlist || (steamAppId != null && !manualWishlisted && allWishlistAppIds.has(steamAppId));
            const wishlistTooltip = pendingWishlist
              ? "Saving entry..."
              : steamAppId == null
                ? manualWishlisted
                  ? "Remove from wishlist"
                  : "Save as a manual wishlist entry"
                : !manualWishlisted && allWishlistAppIds.has(steamAppId)
                  ? "Already on your Steam wishlist."
                  : manualWishlisted
                    ? "Remove manual wishlist entry"
                    : "Add to wishlist";
            return (
              <div key={`${item.id}-${item.slug}`} className="relative space-y-3">
                <article
                  className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-3xl border border-zinc-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-within:outline-none focus-within:ring-2 focus-within:ring-emerald-500"
                  onClick={() => {
                    if (identityId) {
                      setExpandedIdentityId((prev) => (prev === identityId ? null : identityId));
                    } else {
                      setNotice({
                        kind: "info",
                        message: "Add this game to your library to view full details.",
                      });
                    }
                  }}
                  onMouseEnter={() => {
                    if (identityId) {
                      prefetchGameDetailsLazy(identityId);
                    }
                  }}
                >
                  <div className="relative aspect-[16/10] overflow-hidden bg-zinc-200">
                    {item.backgroundImage ? (
                      <img
                        src={item.backgroundImage}
                        alt=""
                        className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                        No artwork
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-zinc-900 line-clamp-2">{item.title}</div>
                      <div className="flex flex-col items-end gap-2">
                        {item.metacritic != null ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600">
                            MC {item.metacritic}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className={clsx(
                            "rounded-full px-3 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                            manualWishlisted
                              ? "bg-emerald-600 text-white"
                              : !manualWishlisted && anyWishlisted
                                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border border-zinc-200 bg-white text-zinc-600 hover:border-emerald-200 hover:text-emerald-600",
                            pendingWishlist ? "opacity-60" : "",
                          )}
                          disabled={buttonDisabled}
                          title={wishlistTooltip}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (buttonDisabled) return;
                            void handleWishlistToggle(item, manualAppId, steamAppId);
                          }}
                        >
                          {wishlistLabel}
                        </button>
                      </div>
                    </div>
                    {item.genres.length ? (
                      <div className="flex flex-wrap gap-1 text-xs text-zinc-500">
                        {item.genres.slice(0, 3).map((genre) => (
                          <span key={genre} className="rounded-full border border-zinc-200 px-2 py-0.5">
                            {genre}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-auto flex justify-between text-xs text-emerald-600">
                      <span>{identityId ? "In library" : "RAWG spotlight"}</span>
                      <a
                        href={`https://rawg.io/games/${item.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        View RAWG
                      </a>
                    </div>
                  </div>
                </article>
                {isExpanded ? (
                  <div className="col-span-full rounded-3xl border border-zinc-200 bg-white p-4 shadow-inner sm:p-6">
                    <Suspense fallback={<div className="text-sm text-zinc-500">Loading details...</div>}>
                      <GameDetails identityId={identityId} />
                    </Suspense>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {state.status === "ready" && !items.length ? (
        <div className="rounded-3xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500">
          No games matched this view yet. Try another tab soon.
        </div>
      ) : null}

      {fetchedLabel ? <div className="text-xs text-zinc-400">Last updated {fetchedLabel}</div> : null}
    </div>
  );
}
