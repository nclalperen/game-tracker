import { normalizeTitle } from "@tracker/core";
import {
  getRawgGameByTitleKey,
  isRawgGameStale,
  upsertRawgGame,
  type RawgGameCache,
} from "@/db";
import { getGame, searchByTitle } from "@/apis/rawg";

const RATE_LIMIT_MS = 1000;
let nextAllowedAt = 0;

async function awaitBudget() {
  const now = Date.now();
  if (now < nextAllowedAt) {
    await new Promise((resolve) => setTimeout(resolve, nextAllowedAt - now));
  }
  nextAllowedAt = Date.now() + RATE_LIMIT_MS;
}

export async function ensureRawgDetail(title: string): Promise<RawgGameCache | null> {
  const titleKey = normalizeTitle(title);
  if (!titleKey) return null;

  const cached = await getRawgGameByTitleKey(titleKey);
  if (cached && !isRawgGameStale(cached)) {
    return cached;
  }

  try {
    await awaitBudget();
    const search = await searchByTitle(title, { precise: true, exact: true, pageSize: 5 });
    const results: any[] = Array.isArray(search?.results) ? search.results : [];
    const best = results[0];
    if (!best?.id) {
      return cached ?? null;
    }
    await awaitBudget();
    const detail = await getGame(best.id);
    if (!detail) return cached ?? null;
    const metacriticScore =
      typeof detail.metacritic === "number" && Number.isFinite(detail.metacritic)
        ? detail.metacritic
        : null;
    const rating =
      typeof detail.rating === "number" && Number.isFinite(detail.rating)
        ? detail.rating
        : null;
    const ratingTop =
      typeof detail.rating_top === "number" && Number.isFinite(detail.rating_top)
        ? detail.rating_top
        : null;
    const ratingsCount =
      typeof detail.ratings_count === "number" && Number.isFinite(detail.ratings_count)
        ? detail.ratings_count
        : null;
    let aggregatedScore: number | null = null;
    if (metacriticScore != null) {
      aggregatedScore = Math.round(metacriticScore);
    } else if (rating != null && ratingTop != null && ratingTop > 0) {
      aggregatedScore = Math.round((rating / ratingTop) * 100);
    }
    const cacheEntry: RawgGameCache = {
      id: detail.id,
      slug: detail.slug,
      title: detail.name ?? title,
      titleKey,
      backgroundImage: detail.background_image ?? null,
      genres: Array.isArray(detail.genres) ? detail.genres.map((g: any) => g?.name).filter(Boolean) : [],
      stores: Array.isArray(detail.stores)
        ? detail.stores
            .map((s: any) => ({
              id: s?.store?.id,
              name: s?.store?.name,
              url: s?.url || s?.store?.domain || null,
            }))
            .filter((s: any) => s.id && s.name)
        : [],
      metacriticScore,
      rating,
      ratingTop,
      ratingsCount,
      aggregatedScore,
      updatedAtISO: detail.updated || detail.updated_at || new Date().toISOString(),
    };
    await upsertRawgGame(cacheEntry);
    return cacheEntry;
  } catch (err) {
    console.warn("RAWG detail lookup failed", err);
    return cached ?? null;
  }
}

export async function getCachedRawgDetail(title: string): Promise<RawgGameCache | null> {
  const titleKey = normalizeTitle(title);
  if (!titleKey) return null;
  const cached = await getRawgGameByTitleKey(titleKey);
  return cached ?? null;
}



