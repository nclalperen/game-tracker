import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  db,
  getRawgExploreRow,
  isRawgExploreStale,
  upsertRawgExploreRow,
  type RawgExploreResult,
} from "@/db";
import { listGames } from "@/apis/rawg";
import { getStoreInfo } from "@/data/storeMap";
import clsx from "clsx";
import Drawer from "@/components/details/Drawer";
import { canonicalPlatform, nanoid, type Identity, type LibraryItem } from "@tracker/core";

const GameDetails = lazy(() => import("../components/details/GameDetails"));

type CategoryKey = "trending" | "top-rated" | "upcoming";
type PlatformKey = "all" | "pc" | "playstation" | "xbox" | "nintendo";

const PLATFORM_PARENT_IDS: Record<Exclude<PlatformKey, "all">, string> = {
  pc: "1",
  playstation: "2",
  xbox: "3",
  nintendo: "7",
};

const CATEGORY_CONFIG: Record<
  CategoryKey,
  {
    label: string;
    buildParams: (platform: PlatformKey) => Record<string, string | number | boolean | undefined>;
    description: string;
  }
> = {
  "trending": {
    label: "Trending",
    description: "Most added games in the past 30 days.",
    buildParams: (platform) => {
      const now = new Date();
      const to = formatDateForQuery(now);
      const from = formatDateForQuery(addDays(now, -30));
      return {
        ordering: "-added",
        dates: `${from},${to}`,
        page_size: 24,
        parent_platforms: platform === "all" ? undefined : PLATFORM_PARENT_IDS[platform],
      };
    },
  },
  "top-rated": {
    label: "Top Rated",
    description: "Highest rated releases from the last year.",
    buildParams: (platform) => {
      const now = new Date();
      const to = formatDateForQuery(now);
      const from = formatDateForQuery(addDays(now, -365));
      return {
        ordering: "-rating",
        dates: `${from},${to}`,
        page_size: 24,
        parent_platforms: platform === "all" ? undefined : PLATFORM_PARENT_IDS[platform],
      };
    },
  },
  "upcoming": {
    label: "Upcoming",
    description: "Most anticipated releases scheduled for the next 6 months.",
    buildParams: (platform) => {
      const now = new Date();
      const from = formatDateForQuery(now);
      const to = formatDateForQuery(addDays(now, 180));
      return {
        ordering: "-added",
        dates: `${from},${to}`,
        page_size: 24,
        parent_platforms: platform === "all" ? undefined : PLATFORM_PARENT_IDS[platform],
      };
    },
  },
};

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

type ExploreState =
  | { status: "loading"; data: RawgExploreResult[] }
  | { status: "ready"; data: RawgExploreResult[]; fetchedAt: string }
  | { status: "error"; message: string; data: RawgExploreResult[] };

export default function ExplorePage() {
  const [category, setCategory] = useState<CategoryKey>("trending");
  const [platform, setPlatform] = useState<PlatformKey>("all");
  const [state, setState] = useState<ExploreState>({ status: "loading", data: [] });
  const [existingRawgIds, setExistingRawgIds] = useState<Set<number>>(new Set());
  const [pendingAddKeys, setPendingAddKeys] = useState<Set<string>>(new Set());
  const [viewLoadingKey, setViewLoadingKey] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await db.identities.toArray();
      if (cancelled) return;
      const set = new Set<number>();
      all.forEach((ident) => {
        if (typeof ident.rawgId === "number") {
          set.add(ident.rawgId);
        }
      });
      setExistingRawgIds(set);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const markRawgId = useCallback((rawgId?: number) => {
    if (typeof rawgId !== "number") return;
    setExistingRawgIds((prev) => {
      if (prev.has(rawgId)) return prev;
      const next = new Set(prev);
      next.add(rawgId);
      return next;
    });
  }, []);

  const ensureIdentityForResult = useCallback(
    async (
      result: RawgExploreResult,
      opts?: { createLibrary?: boolean },
    ): Promise<{ identity: Identity; library?: LibraryItem; createdLibrary: boolean }> => {
      let identity =
        (await db.identities
          .filter((ident) => {
            if (typeof result.id === "number" && ident.rawgId === result.id) return true;
            if (result.slug && ident.rawgSlug === result.slug) return true;
            return false;
          })
          .first()) ?? null;

      if (!identity) {
        const identityId = `rawg-${result.id ?? nanoid()}`;
        identity = {
          id: identityId,
          title: result.name,
          platform: canonicalPlatform(result.platforms[0] ?? undefined),
          rawgId: typeof result.id === "number" ? result.id : null,
          rawgSlug: result.slug ?? null,
          mcScore: result.metacritic ?? null,
          ocScore: result.rating != null ? Math.round(result.rating * 20) : null,
          criticScoreSource:
            result.metacritic != null
              ? "metacritic"
              : result.rating != null
                ? "rawg"
                : undefined,
        };
        await db.identities.put(identity);
      }

      let library: LibraryItem | undefined = undefined;
      let createdLibrary = false;
      if (opts?.createLibrary) {
        library = await db.library.where("identityId").equals(identity.id).first();
        if (!library) {
          library = {
            id: nanoid(),
            identityId: identity.id,
            status: "Wishlist",
            source: "rawg-explore",
          };
          await db.library.put(library);
          createdLibrary = true;
        }
      }

      markRawgId(result.id);
      return { identity, library, createdLibrary };
    },
    [markRawgId],
  );

  const cacheKey = useMemo(() => `${category}::${platform}`, [category, platform]);

  const getResultKey = useCallback(
    (result: RawgExploreResult) => (result.id != null ? `id:${result.id}` : `slug:${result.slug ?? result.name}`),
    [],
  );

  const markPendingAdd = useCallback((key: string, pending: boolean) => {
    setPendingAddKeys((prev) => {
      const next = new Set(prev);
      if (pending) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const isResultInLibrary = useCallback(
    (result: RawgExploreResult) => typeof result.id === "number" && existingRawgIds.has(result.id),
    [existingRawgIds],
  );

  const handleAddToLibrary = useCallback(
    async (result: RawgExploreResult) => {
      const key = getResultKey(result);
      markPendingAdd(key, true);
      try {
        const { identity, createdLibrary } = await ensureIdentityForResult(result, { createLibrary: true });
        invalidateGameDetailsLazy(identity.id);
        prefetchGameDetailsLazy(identity.id);
        setDrawerId(identity.id);
        setToast({
          kind: "success",
          message: createdLibrary
            ? `${identity.title} added to your library.`
            : `${identity.title} is already in your library.`,
        });
      } catch (err: any) {
        setToast({ kind: "error", message: err?.message || "Failed to add game to your library." });
      } finally {
        markPendingAdd(key, false);
      }
    },
    [ensureIdentityForResult, getResultKey, markPendingAdd],
  );

  const handleViewDetails = useCallback(
    async (result: RawgExploreResult) => {
      const key = getResultKey(result);
      setViewLoadingKey(key);
      try {
        const { identity } = await ensureIdentityForResult(result);
        prefetchGameDetailsLazy(identity.id);
        setDrawerId(identity.id);
      } catch (err: any) {
        setToast({ kind: "error", message: err?.message || "Unable to load RAWG details." });
      } finally {
        setViewLoadingKey((current) => (current === key ? null : current));
      }
    },
    [ensureIdentityForResult, getResultKey],
  );

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ status: "loading", data: prev.data }));

    (async () => {
      try {
        const cached = await getRawgExploreRow(cacheKey);
        if (!cancelled && cached && !isRawgExploreStale(cached)) {
          setState({ status: "ready", data: cached.results, fetchedAt: cached.lastFetchedISO });
          return;
        }

        const params = CATEGORY_CONFIG[category].buildParams(platform);
        const json = await listGames(params);
        const results: RawgExploreResult[] = Array.isArray(json?.results)
          ? json.results.map((game: any) => ({
              id: game?.id ?? 0,
              slug: game?.slug ?? "",
              name: game?.name ?? "Untitled",
              backgroundImage: game?.background_image ?? null,
              rating: typeof game?.rating === "number" ? game.rating : null,
              metacritic: typeof game?.metacritic === "number" ? game.metacritic : null,
              released: game?.released ?? null,
              genres: Array.isArray(game?.genres) ? game.genres.map((g: any) => g?.name).filter(Boolean) : [],
              platforms: Array.isArray(game?.parent_platforms)
                ? game.parent_platforms
                    .map((p: any) => p?.platform?.name)
                    .filter(Boolean)
                : [],
              stores: Array.isArray(game?.stores)
                ? game.stores
                    .map((s: any) => ({
                      id: s?.store?.id,
                      name: s?.store?.name,
                      url: s?.url || s?.store?.domain || null,
                      domain: s?.store?.domain ?? null,
                    }))
                    .filter((store: any) => Number.isFinite(store.id) && store.name)
                : [],
            }))
          : [];

        const row = {
          key: cacheKey,
          results,
          lastFetchedISO: new Date().toISOString(),
        };
        await upsertRawgExploreRow(row);
        if (!cancelled) {
          setState({ status: "ready", data: results, fetchedAt: row.lastFetchedISO });
        }
      } catch (err: any) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err?.message || "RAWG explore fetch failed.",
            data: [],
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, category, platform]);

  const activeConfig = CATEGORY_CONFIG[category];
  const isLoading = state.status === "loading";

  return (
    <>
      {toast ? (
        <div
          className={clsx(
            "fixed bottom-4 right-4 z-50 rounded-2xl px-4 py-3 text-sm shadow-lg",
            toast.kind === "success" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white",
          )}
        >
          {toast.message}
        </div>
      ) : null}

      <div className="space-y-6">
        <header className="rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm sm:flex sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Explore games</h1>
            <p className="text-sm text-zinc-500">{activeConfig.description}</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0">
          {(Object.keys(CATEGORY_CONFIG) as CategoryKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              className={clsx(
                "rounded-full px-3 py-1 text-sm font-semibold transition",
                category === key ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
              )}
            >
              {CATEGORY_CONFIG[key].label}
            </button>
          ))}
          <select
            className="select text-sm"
            value={platform}
            onChange={(event) => setPlatform(event.target.value as PlatformKey)}
            aria-label="Filter by platform"
          >
            <option value="all">All platforms</option>
            <option value="pc">PC</option>
            <option value="playstation">PlayStation</option>
            <option value="xbox">Xbox</option>
            <option value="nintendo">Nintendo</option>
          </select>
        </div>
      </header>

      {state.status === "error" ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {state.message}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 12 }).map((_, index) => (
              <div
                key={`skeleton-${index}`}
                className="h-64 animate-pulse rounded-3xl border border-zinc-100 bg-zinc-100/80"
              />
            ))
          : state.data.map((item, index) => {
              const key = getResultKey(item);
              return (
                <ExploreCard
                  key={item.id || `${item.slug}-${index}`}
                  data={item}
                  onView={() => handleViewDetails(item)}
                  onAdd={() => handleAddToLibrary(item)}
                  viewing={viewLoadingKey === key}
                  adding={pendingAddKeys.has(key)}
                  inLibrary={isResultInLibrary(item)}
                />
              );
            })}
      </section>

      {state.status === "ready" && !state.data.length ? (
        <div className="rounded-3xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 text-center">
          No games found. Try a different platform or category.
        </div>
      ) : null}
      </div>

      <Drawer open={drawerId != null} onClose={() => setDrawerId(null)}>
        {drawerId ? (
          <Suspense fallback={<div className="p-4 text-sm text-zinc-500">Loading game details...</div>}>
            <GameDetails identityId={drawerId} />
          </Suspense>
        ) : null}
      </Drawer>
    </>
  );
}

function ExploreCard({
  data,
  onView,
  onAdd,
  viewing,
  adding,
  inLibrary,
}: {
  data: RawgExploreResult;
  onView: () => void;
  onAdd: () => void;
  viewing: boolean;
  adding: boolean;
  inLibrary: boolean;
}) {
  const releaseLabel = data.released ? formatDateDisplay(data.released) : "TBA";
  const ratingLabel =
    data.metacritic != null ? `MC ${data.metacritic}` : data.rating != null ? `RAWG ${(data.rating * 20).toFixed(0)}` : null;
  const topStores = (data.stores ?? []).slice(0, 3);

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-zinc-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative aspect-[16/10] overflow-hidden bg-zinc-200">
        {data.backgroundImage ? (
          <img src={data.backgroundImage} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold text-zinc-900 line-clamp-2">{data.name}</div>
          {ratingLabel ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600">
              {ratingLabel}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span className="rounded-full border border-zinc-200 px-2 py-0.5">Release {releaseLabel}</span>
          {data.platforms.slice(0, 3).map((platform) => (
            <span key={platform} className="rounded-full border border-zinc-200 px-2 py-0.5">
              {platform}
            </span>
          ))}
        </div>
        {topStores.length ? (
          <div className="mt-auto flex flex-wrap gap-2 text-xs text-emerald-600">
            {topStores.map((store) => {
              const info = getStoreInfo(store.id) ?? { name: store.name };
              return (
                <span
                  key={`${store.id}-${store.name}`}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold"
                  title={info.name}
                >
                  <span className="text-[11px] uppercase">{info.icon ?? info.name.slice(0, 2)}</span>
                  <span className="hidden sm:inline">{info.name}</span>
                </span>
              );
            })}
          </div>
        ) : null}
        <div className="mt-2 flex justify-between text-xs text-emerald-600">
          <span>{data.genres.slice(0, 2).join(", ")}</span>
          <a
            href={`https://rawg.io/games/${data.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold hover:underline"
          >
            RAWG
          </a>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onView}
            className="btn flex-1"
            disabled={viewing}
          >
            {viewing ? "Opening..." : "View details"}
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="btn-ghost flex-1 sm:flex-none sm:min-w-[8rem]"
            disabled={adding || inLibrary}
          >
            {inLibrary ? "In library" : adding ? "Adding..." : "Add to library"}
          </button>
        </div>
      </div>
    </article>
  );
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateForQuery(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDateDisplay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "TBA";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
