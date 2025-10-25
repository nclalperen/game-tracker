const BASE_URL = "https://api.rawg.io/api";
const TTL_MS = 30 * 60 * 1000; // 30 minutes
const API_KEY = import.meta.env.VITE_RAWG_KEY as string | undefined;

type CacheEntry<T> = { value: T; expires: number };

type Bucket = "search" | "detail" | "screenshots" | "movies";

const caches: Record<Bucket, Map<string, CacheEntry<unknown>>> = {
  search: new Map(),
  detail: new Map(),
  screenshots: new Map(),
  movies: new Map(),
};

function buildKey(path: string, params: URLSearchParams): string {
  return `${path}?${params.toString()}`;
}

async function fetchJson<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  bucket: Bucket,
): Promise<T> {
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
  if (cached && cached.expires > now) {
    return cached.value as T;
  }

  const url = `${BASE_URL}${path}?${searchParams.toString()}`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`RAWG request failed (${resp.status})`);
  }
  const json = (await resp.json()) as T;
  bucketCache.set(cacheKey, { value: json, expires: now + TTL_MS });
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
