import { isVendorEnabled } from "@/state/vendorFlags";

const BASE_URL = "https://api.rawg.io/api";
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const LIST_TTL_MS = 60 * 60 * 1000; // 1 hour
const SUGGESTED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REQUEST_INTERVAL_MS = 1000; // 1 req / sec
const API_KEY = import.meta.env.VITE_RAWG_KEY as string | undefined;

type CacheEntry<T> = { value: T; expires: number };

type Bucket = "search" | "detail" | "screenshots" | "movies" | "list" | "suggested";

const caches: Record<Bucket, Map<string, CacheEntry<unknown>>> = {
  search: new Map(),
  detail: new Map(),
  screenshots: new Map(),
  movies: new Map(),
  list: new Map(),
  suggested: new Map(),
};

const BUCKET_TTLS: Partial<Record<Bucket, number>> = {
  list: LIST_TTL_MS,
  suggested: SUGGESTED_TTL_MS,
};

let lastRequestTime = 0;

function buildKey(path: string, params: URLSearchParams): string {
  return `${path}?${params.toString()}`;
}

async function applyRateLimit(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, REQUEST_INTERVAL_MS - (now - lastRequestTime));
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestTime = Date.now();
}

async function fetchJson<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  bucket: Bucket,
  ttlOverrideMs?: number,
): Promise<T> {
  if (!isVendorEnabled("rawg")) {
    throw new Error("RAWG integration disabled in Settings.");
  }
  if (!API_KEY) {
    throw new Error("RAWG API key (VITE_RAWG_KEY) is not configured.");
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    searchParams.set(key, String(value));
  }
  searchParams.set("key", API_KEY);

  const cacheKey = buildKey(path, searchParams);
  const bucketCache = caches[bucket];
  const now = Date.now();
  const cached = bucketCache.get(cacheKey);
  const ttl = ttlOverrideMs ?? BUCKET_TTLS[bucket] ?? DEFAULT_TTL_MS;
  if (cached && cached.expires > now) {
    return cached.value as T;
  }

  const url = `${BASE_URL}${path}?${searchParams.toString()}`;
  await applyRateLimit();
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`RAWG request failed (${resp.status})`);
  }
  const json = (await resp.json()) as T;
  bucketCache.set(cacheKey, { value: json, expires: now + ttl });
  return json;
}

export async function searchByTitle(
  query: string,
  opts?: { exact?: boolean; precise?: boolean; pageSize?: number },
): Promise<any> {
  const params = {
    search: query,
    search_exact: opts?.exact ? "true" : undefined,
    search_precise: opts?.precise ? "true" : undefined,
    page_size: opts?.pageSize ?? 20,
  } as Record<string, string | number | boolean | undefined>;
  return fetchJson("/games", params, "search");
}

export async function getGame(idOrSlug: string | number): Promise<any> {
  const path = typeof idOrSlug === "number" ? `/games/${idOrSlug}` : `/games/${encodeURIComponent(idOrSlug)}`;
  return fetchJson(path, {}, "detail");
}

export async function getScreenshots(id: number, pageSize = 8): Promise<any> {
  return fetchJson(`/games/${id}/screenshots`, { page_size: pageSize }, "screenshots");
}

export async function getMovies(id: number): Promise<any> {
  return fetchJson(`/games/${id}/movies`, {}, "movies");
}

export async function listGames(params: Record<string, string | number | boolean | undefined>): Promise<any> {
  return fetchJson("/games", params, "list", LIST_TTL_MS);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function listTrending(page = 1): Promise<any> {
  const now = new Date();
  const to = formatDate(now);
  const from = formatDate(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  return fetchJson(
    "/games",
    {
      ordering: "-added",
      dates: `${from},${to}`,
      page,
      page_size: 20,
    },
    "list",
    LIST_TTL_MS,
  );
}

export async function listUpcoming(page = 1): Promise<any> {
  const now = new Date();
  const from = formatDate(now);
  const to = formatDate(new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000));
  return fetchJson(
    "/games",
    {
      ordering: "-added",
      dates: `${from},${to}`,
      page,
      page_size: 20,
    },
    "list",
    LIST_TTL_MS,
  );
}

export async function listNewReleases(page = 1): Promise<any> {
  const now = new Date();
  const to = formatDate(now);
  const from = formatDate(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  return fetchJson(
    "/games",
    {
      ordering: "-released",
      dates: `${from},${to}`,
      page,
      page_size: 20,
    },
    "list",
    LIST_TTL_MS,
  );
}

export async function getSuggested(id: number, page = 1): Promise<any> {
  return fetchJson(`/games/${id}/suggested`, { page, page_size: 20 }, "suggested", SUGGESTED_TTL_MS);
}

export function clearRawgApiCache(): void {
  (Object.values(caches) as Array<Map<string, CacheEntry<unknown>>>).forEach((bucket) => bucket.clear());
}
