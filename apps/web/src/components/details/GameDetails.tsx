import { useEffect, useMemo, useState, useCallback } from "react";
import { normalizeTitle } from "@tracker/core";
import type { Identity, LibraryItem } from "@tracker/core";
import {
  db,
  getRawgGame,
  getRawgGameByTitleKey,
  upsertRawgGame,
  isRawgGameStale,
  isRawgMediaStale,
  type RawgGameCache,
  type RawgMovie,
  type RawgScreenshot,
  type RawgStoreInfo,
} from "@/db";
import { searchByTitle, getGame, getScreenshots, getMovies } from "@/apis/rawg";
import { sanitizeHtml } from "@/utils/sanitizeHtml";
import { getStoreInfo } from "@/data/storeMap";
import GameCover from "@/components/GameCover";
import { pricePerHour } from "@tracker/core";
import clsx from "clsx";
import { useVendorFlag, isVendorEnabled } from "@/state/vendorFlags";

type RequestTask<T> = () => Promise<T>;

type GameDetailsData = {
  identity: Identity;
  libraryItems: LibraryItem[];
  rawg: RawgGameCache | null;
  sanitizedDescription: string;
  backgroundImage: string | null;
  coverUrl: string | null;
  coverAlt: string;
  criticBadge?: {
    value: number;
    source: "metacritic" | "opencritic" | "rawg";
    label: string;
    aria: string;
  };
  criticSources: Array<{ source: string; value: number | null }>;
  ttb: {
    value: number | null;
    sourceLabel: string | null;
    aria: string;
  };
  genres: string[];
  tags: string[];
  developers: string[];
  publishers: string[];
  releaseDate: string | null;
  esrb: string | null;
  stores: RawgStoreInfo[];
  screenshots: RawgScreenshot[];
  movies: RawgMovie[];
  ocScore: number | null;
  mcScore: number | null;
  rawgScore: number | null;
};

type GameDetailsState =
  | { status: "loading" }
  | { status: "ready"; data: GameDetailsData }
  | { status: "error"; message: string };

const MEMORY_CACHE_MAX = 20;
const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000;
const PREFETCH_COOLDOWN_MS = 3000;

const inMemoryCache = new Map<string, { data: GameDetailsData; timestamp: number }>();
const pendingPrefetch = new Map<string, Promise<void>>();
let lastOpened: { id: string; time: number } | null = null;

let requestQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function scheduleRawg<T>(task: RequestTask<T>): Promise<T> {
  const run = async () => {
    const now = Date.now();
    const wait = Math.max(0, lastRequestAt + 1000 - now);
    if (wait > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, wait));
    }
    const result = await task();
    lastRequestAt = Date.now();
    return result;
  };

  const next = requestQueue.then(run, run);
  requestQueue = next.then(
    () => {},
    () => {},
  );
  return next;
}

function remember(id: string, data: GameDetailsData) {
  inMemoryCache.set(id, { data, timestamp: Date.now() });
  if (inMemoryCache.size > MEMORY_CACHE_MAX) {
    const [oldestKey] =
      [...inMemoryCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0] ?? [];
    if (oldestKey) inMemoryCache.delete(oldestKey);
  }
}

function fromMemory(id: string): GameDetailsData | undefined {
  const cached = inMemoryCache.get(id);
  if (!cached) return undefined;
  if (Date.now() - cached.timestamp > MEMORY_CACHE_TTL_MS) {
    inMemoryCache.delete(id);
    return undefined;
  }
  return cached.data;
}

async function loadLibraryItems(identityId: string): Promise<LibraryItem[]> {
  return db.library.where("identityId").equals(identityId).toArray();
}

function computeCover(identity: Identity, rawg: RawgGameCache | null): { coverUrl: string | null; alt: string } {
  if (identity.appid) {
    return {
      coverUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${identity.appid}/library_600x900.jpg`,
      alt: `${identity.title} cover art`,
    };
  }
  if (rawg?.backgroundImage) {
    return { coverUrl: rawg.backgroundImage, alt: `${rawg.title} artwork` };
  }
  if (identity.igdbCoverId) {
    return {
      coverUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/${identity.igdbCoverId}.jpg`,
      alt: `${identity.title} cover art`,
    };
  }
  return { coverUrl: null, alt: `${identity.title} cover placeholder` };
}

async function resolveRawgDetail(identity: Identity): Promise<RawgGameCache | null> {
  const titleKey = normalizeTitle(identity.title ?? "");
  if (!titleKey) return null;

  const cachedByTitle = await getRawgGameByTitleKey(titleKey);
  if (!isVendorEnabled("rawg")) {
    return null;
  }
  if (cachedByTitle && !isRawgGameStale(cachedByTitle)) {
    if (!identity.rawgId && cachedByTitle?.id) {
      await db.identities.update(identity.id, {
        rawgId: cachedByTitle.id,
        rawgSlug: cachedByTitle.slug,
      } as Partial<Identity>);
    }
    return cachedByTitle;
  }

  if (identity.rawgId) {
    const cached = await getRawgGame(identity.rawgId);
    if (cached && !isRawgGameStale(cached)) {
      return cached;
    }
  }

  const attempts: Array<{ precise?: boolean; exact?: boolean }> = [
    { precise: true, exact: true },
    { precise: true },
    {},
  ];

  let bestResult: any | null = null;
  for (const attempt of attempts) {
    const search = await scheduleRawg(() =>
      searchByTitle(identity.title ?? "", {
        precise: attempt.precise,
        exact: attempt.exact,
        pageSize: 5,
      }),
    );
    const results: any[] = Array.isArray(search?.results) ? search.results : [];
    if (results.length > 0) {
      bestResult = results[0];
      break;
    }
  }
  if (!bestResult?.id) {
    return cachedByTitle ?? null;
  }

  const detail = await scheduleRawg(() => getGame(bestResult.id));
  const cacheEntry = mapRawgDetail(detail, identity.title ?? "");
  await upsertRawgGame(cacheEntry);
  await db.identities.update(identity.id, {
    rawgId: cacheEntry.id,
    rawgSlug: cacheEntry.slug,
  } as Partial<Identity>);
  return cacheEntry;
}

function mapRawgDetail(detail: any, fallbackTitle: string): RawgGameCache {
  const title = detail?.name ?? fallbackTitle;
  const titleKey = normalizeTitle(title) ?? title.toLowerCase();
  const genres =
    Array.isArray(detail?.genres) && detail.genres.length
      ? detail.genres.map((g: any) => g?.name).filter(Boolean)
      : [];
  const tags =
    Array.isArray(detail?.tags) && detail.tags.length
      ? detail.tags.map((t: any) => t?.name).filter(Boolean)
      : undefined;
  const platforms =
    Array.isArray(detail?.platforms) && detail.platforms.length
      ? detail.platforms
          .map((p: any) => p?.platform?.name)
          .filter(Boolean)
      : undefined;
  const stores =
    Array.isArray(detail?.stores) && detail.stores.length
      ? detail.stores
          .map((s: any) => ({
            id: s?.store?.id,
            name: s?.store?.name,
            url: s?.url,
            domain: s?.store?.domain ?? null,
          }))
          .filter((s: any) => s.id && s.name)
      : [];
  return {
    id: detail?.id,
    slug: detail?.slug ?? titleKey,
    title,
    titleKey,
    descriptionRaw: detail?.description ?? detail?.description_raw ?? "",
    backgroundImage: detail?.background_image ?? null,
    backgroundImageAdditional: detail?.background_image_additional ?? null,
    genres,
    tags,
    platforms,
    stores,
    developers: Array.isArray(detail?.developers) ? detail.developers.map((d: any) => d?.name).filter(Boolean) : [],
    publishers: Array.isArray(detail?.publishers) ? detail.publishers.map((p: any) => p?.name).filter(Boolean) : [],
    esrb: detail?.esrb_rating?.name ?? null,
    playtimeHours: typeof detail?.playtime === "number" ? detail.playtime : null,
    screenshotsCount: detail?.screenshots_count ?? null,
    metacriticScore: typeof detail?.metacritic === "number" ? detail.metacritic : null,
    rating: typeof detail?.rating === "number" ? detail.rating : null,
    ratingTop: typeof detail?.rating_top === "number" ? detail.rating_top : null,
    ratingsCount: typeof detail?.ratings_count === "number" ? detail.ratings_count : null,
    aggregatedScore:
      typeof detail?.metacritic === "number"
        ? Math.round(detail.metacritic)
        : typeof detail?.rating === "number" && typeof detail?.rating_top === "number" && detail.rating_top > 0
          ? Math.round((detail.rating / detail.rating_top) * 100)
          : null,
    rawgScore: typeof detail?.score === "number" ? detail.score : null,
    released: detail?.released ?? null,
    updatedAtISO: new Date().toISOString(),
  };
}

async function ensureMedia(rawg: RawgGameCache | null): Promise<RawgGameCache | null> {
  if (!rawg) return null;
  if (rawg.screenshots && rawg.movies && !isRawgMediaStale(rawg)) {
    return rawg;
  }
  if (!isVendorEnabled("rawg")) {
    return rawg;
  }
  const [screenshotsResp, moviesResp] = await Promise.all([
    scheduleRawg(() => getScreenshots(rawg.id)),
    scheduleRawg(() => getMovies(rawg.id)),
  ]);
  const screenshots: RawgScreenshot[] = Array.isArray(screenshotsResp?.results)
    ? screenshotsResp.results
        .map((shot: any) => ({
          id: shot?.id,
          image: shot?.image,
          width: shot?.width,
          height: shot?.height,
        }))
        .filter((shot: RawgScreenshot) => Boolean(shot.id && shot.image))
    : [];
  const movies: RawgMovie[] = Array.isArray(moviesResp?.results)
    ? moviesResp.results
        .map((movie: any) => ({
          id: movie?.id,
          name: movie?.name ?? "Trailer",
          preview: movie?.preview ?? null,
          data: movie?.data,
        }))
        .filter((movie: RawgMovie) => Boolean(movie.id))
    : [];

  const merged: RawgGameCache = {
    ...rawg,
    screenshots,
    movies,
    mediaUpdatedAtISO: new Date().toISOString(),
  };
  await upsertRawgGame(merged);
  return merged;
}

    rawgScore,
  } satisfies GameDetailsData;
}

async function ensureGameDetails(identityId: string, opts?: { prefetch?: boolean }): Promise<GameDetailsData> {
  const memory = fromMemory(identityId);
  if (memory) return memory;

  const identity = await db.identities.get(identityId);
  if (!identity) {
    throw new Error("Identity not found");
  }
  const libraryItems = await loadLibraryItems(identityId);
  const allowRawg = isVendorEnabled("rawg");
  const allowMetacritic = isVendorEnabled("metacritic");
  let rawg: RawgGameCache | null = null;
  if (allowRawg) {
    rawg = await resolveRawgDetail(identity);
  }

  if (allowRawg && !opts?.prefetch) {
    rawg = await ensureMedia(rawg);
  }

  const data = await buildViewModel(identity, libraryItems, allowRawg ? rawg : null, {
    rawgEnabled: allowRawg,
    metacriticEnabled: allowMetacritic,
  });
  remember(identityId, data);
  return data;
}

export function markGameDetailsOpened(id: string) {
  lastOpened = { id, time: Date.now() };
}

export function prefetchGameDetails(id: string) {
  if (!id) return;
  const lastOpen = lastOpened;
  if (lastOpen && lastOpen.id === id && Date.now() - lastOpen.time < PREFETCH_COOLDOWN_MS) {
    return;
  }
  if (fromMemory(id)) return;
  if (pendingPrefetch.has(id)) return;
  const task = ensureGameDetails(id, { prefetch: true }).catch(() => {}).finally(() => {
    pendingPrefetch.delete(id);
  });
  pendingPrefetch.set(id, task.then(() => {}));
}

function useGameDetails(identityId: string): GameDetailsState {
  const [state, setState] = useState<GameDetailsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    ensureGameDetails(identityId)
      .then((data) => {
        if (cancelled) return;
        setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: (err as Error)?.message ?? "Failed to load details." });
      });
    return () => {
      cancelled = true;
    };
  }, [identityId]);

  return state;
}

function formatCurrency(code?: string | null) {
  if (!code) return "";
  const map: Record<string, string> = {
    USD: "$",
    EUR: "Γé¼",
    GBP: "┬ú",
    JPY: "┬Ñ",
    TRY: "TRY",
  };
  return map[code.toUpperCase()] ?? code.toUpperCase();
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-1/2 animate-pulse rounded bg-zinc-200" />
      <div className="h-48 w-full animate-pulse rounded bg-zinc-200" />
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-zinc-200" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-200" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-200" />
      </div>
    </div>
  );
}

function useTab(initialTab: string) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const setTab = useCallback((tab: string) => {
    setActiveTab(tab);
  }, []);
  return { activeTab, setTab };
}

type TabKey = "media" | "overview" | "stores";

function ScoreBadge({ badge }: { badge: GameDetailsData["criticBadge"] }) {
  if (!badge) return null;
  const baseClass =
    badge.source === "metacritic"
      ? "bg-blue-600"
      : badge.source === "opencritic"
        ? "bg-emerald-600"
        : "bg-indigo-600";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-white",
        baseClass,
      )}
      aria-label={badge.aria}
    >
      <span>{badge.label}</span>
      <span>{badge.value}</span>
    </span>
  );
}

function TtbBadge({ ttb }: { ttb: GameDetailsData["ttb"] }) {
  if (ttb.value == null) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-700"
      aria-label={ttb.aria}
    >
      <span>{ttb.sourceLabel ?? "TTB"}</span>
      <span>{ttb.value}h</span>
    </span>
  );
}

function MediaTab({
  backgroundImage,
  screenshots,
  movies,
}: {
  backgroundImage: string | null;
  screenshots: RawgScreenshot[];
  movies: RawgMovie[];
}) {
  const [selectedShot, setSelectedShot] = useState(0);
  const hero = screenshots[selectedShot] ?? screenshots[0];

  return (
    <div className="space-y-4">
      {hero ? (
        <img
          src={hero.image}
          alt="Gameplay screenshot"
          className="w-full rounded-lg border border-zinc-200 object-cover"
        />
      ) : backgroundImage ? (
        <img
          src={backgroundImage}
          alt="Background artwork"
          className="w-full rounded-lg border border-zinc-200 object-cover"
        />
      ) : (
        <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-500">
          No media available.
        </div>
      )}

      {screenshots.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {screenshots.slice(0, 10).map((shot, index) => (
            <button
              key={shot.id}
              type="button"
              onClick={() => setSelectedShot(index)}
              className={clsx(
                "h-20 w-32 flex-shrink-0 overflow-hidden rounded border",
                selectedShot === index ? "border-emerald-600" : "border-transparent",
              )}
              aria-label={`Screenshot ${index + 1}`}
            >
              <img src={shot.image} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {movies.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-zinc-700">Trailers</h3>
          {movies.slice(0, 3).map((movie) => {
            const source = movie.data?.max ?? movie.data?.["480"] ?? movie.preview;
            if (!source) return null;
            return (
              <video key={movie.id} controls className="w-full rounded-lg border border-zinc-200">
                <source src={source} />
                Your browser does not support embedded video.
              </video>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ data }: { data: GameDetailsData }) {
  const { sanitizedDescription, genres, developers, publishers, releaseDate, esrb, tags, rawg } = data;
  const overviewHeadingId = "game-details-overview-heading";
  const descriptionBodyId = "game-details-description";
  return (
    <div className="space-y-4">
      <section aria-labelledby={overviewHeadingId}>
        <h3 id={overviewHeadingId} className="text-sm font-semibold text-zinc-700">
          Overview
        </h3>
        {sanitizedDescription ? (
          <div
            id={descriptionBodyId}
            className="prose prose-sm max-w-none text-zinc-700"
            dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
          />
        ) : (
          <p id={descriptionBodyId} className="text-sm text-zinc-500">
            No description available.
          </p>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Genres</h4>
          <p className="text-sm text-zinc-700">{genres.length ? genres.join(", ") : "-"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Tags</h4>
          <p className="text-sm text-zinc-700">{tags.length ? tags.slice(0, 8).join(", ") : "-"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Developers</h4>
          <p className="text-sm text-zinc-700">{developers.length ? developers.join(", ") : "-"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Publishers</h4>
          <p className="text-sm text-zinc-700">{publishers.length ? publishers.join(", ") : "-"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">Release Date</h4>
          <p className="text-sm text-zinc-700">{releaseDate ?? "-"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">ESRB</h4>
          <p className="text-sm text-zinc-700">{esrb ?? "-"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-zinc-500">RAWG Link</h4>
          {rawg?.slug ? (
            <a
              href={`https://rawg.io/games/${rawg.slug}`}
              target="_blank"
              rel="noopener"
              className="text-sm text-emerald-600 hover:underline"
            >
              Open on RAWG
            </a>
          ) : (
            <span className="text-sm text-zinc-700">-</span>
          )}
        </div>
      </section>
    </div>
  );
}

function StoresTab({ stores }: { stores: RawgStoreInfo[] }) {
  if (!stores.length) {
    return <p className="text-sm text-zinc-500">No store links available.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {stores.map((store) => {
        const info = getStoreInfo(store.id) ?? { name: store.name };
        const href = store.url ?? (store.domain ? `https://${store.domain}` : undefined);
        return (
          <a
            key={`${store.id}-${store.url ?? store.name}`}
            href={href}
            target="_blank"
            rel="noopener"
            className="btn border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            {info.name}
          </a>
        );
      })}
    </div>
  );
}

export default function GameDetails({ identityId }: { identityId: string }) {
  const state = useGameDetails(identityId);
  const { activeTab, setTab } = useTab("media");

  useEffect(() => {
    if (state.status === "ready") {
      markGameDetailsOpened(identityId);
    }
  }, [identityId, state.status]);

  if (state.status === "error") {
    return (
      <div className="space-y-4">
        <h2 id="game-details-title" className="text-xl font-semibold text-zinc-800">
          Unable to load game details
        </h2>
        <p className="text-sm text-red-600">{state.message}</p>
      </div>
    );
  }

  if (state.status === "loading") {
    return <DetailSkeleton />;
  }

  const data = state.data;

  const price = useMemo(() => {
    const entry = data.libraryItems[0];
    if (!entry?.priceTRY) return null;
    return `${formatCurrency(entry.currencyCode ?? "TRY")} ${entry.priceTRY}`;
  }, [data.libraryItems]);

  const pph = useMemo(() => {
    const entry = data.libraryItems[0];
    if (!entry) return null;
    const value = pricePerHour(entry.priceTRY, entry.ttbMedianMainH ?? data.ttb.value ?? undefined);
    if (value == null) return null;
    return `${formatCurrency(entry.currencyCode ?? "TRY")} ${value}`;
  }, [data.libraryItems, data.ttb.value]);

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-3">
            <h2 id="game-details-title" className="text-2xl font-semibold text-zinc-900">
              {data.identity.title}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {data.identity.platform ? (
                <span className="badge">{data.identity.platform}</span>
              ) : null}
              {data.criticBadge ? <ScoreBadge badge={data.criticBadge} /> : null}
              <TtbBadge ttb={data.ttb} />
              {price ? (
                <span className="inline-flex items-center rounded bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700">
                  Price {price}
                </span>
              ) : null}
              {pph ? (
                <span className="inline-flex items-center rounded bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700">
                  {pph}/h
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-28 w-20 overflow-hidden rounded border border-zinc-200 bg-zinc-100">
              <GameCover identity={data.identity} size="md" />
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-zinc-600">
          {data.criticSources
            .filter((score) => score.value != null)
            .map((score) => (
              <span key={score.source} className="rounded bg-zinc-100 px-2 py-1">
                {score.source}: {score.value}
              </span>
            ))}
        </div>
      </header>

      <nav className="flex gap-2 border-b border-zinc-200 pb-2 text-sm font-medium text-zinc-500">
        {[
          ["media", "Media"],
          ["overview", "Overview"],
          ["stores", "Stores"],
        ].map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setTab(tab)}
            className={clsx(
              "rounded px-3 py-1 transition-colors",
              activeTab === tab ? "bg-emerald-600 text-white" : "hover:bg-zinc-100",
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "media" && (
        <MediaTab
          backgroundImage={data.backgroundImage}
          screenshots={data.screenshots}
          movies={data.movies}
        />
      )}
      {activeTab === "overview" && <OverviewTab data={data} />}
      {activeTab === "stores" && <StoresTab stores={data.stores} />}
    </div>
  );
}
