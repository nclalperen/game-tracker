import { db, type DealView, type SteamPriceRow, type WishlistItem } from "@/db";
import type { Identity, LibraryItem } from "@tracker/core";
import { computeDealScore } from "@tracker/core";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function selectCriticScore(identity: Identity | null | undefined): number | null {
  if (!identity) return null;
  if (identity.criticScoreSource === "metacritic" && identity.mcScore != null) {
    return identity.mcScore;
  }
  if (identity.criticScoreSource === "opencritic" && identity.ocScore != null) {
    return identity.ocScore;
  }
  return identity.mcScore ?? identity.ocScore ?? null;
}

function computeValuePerHour(finalMinor?: number | null, ttbMainH?: number | null): number | null {
  if (finalMinor == null || finalMinor <= 0) return null;
  if (ttbMainH == null || ttbMainH <= 0) return null;
  const finalMajor = finalMinor / 100;
  const value = finalMajor / ttbMainH;
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}

function computeSaleEndsInDays(saleEndISO?: string | null): number | null {
  if (!saleEndISO) return null;
  const saleEnd = Date.parse(saleEndISO);
  if (Number.isNaN(saleEnd)) return null;
  const diff = saleEnd - Date.now();
  if (diff <= 0) return 0;
  return Number((diff / ONE_DAY_MS).toFixed(2));
}

export function toDealView(
  identity: Identity | null | undefined,
  library: LibraryItem | null | undefined,
  price: SteamPriceRow | null | undefined,
  wishlist?: WishlistItem | null,
): DealView {
  const appid =
    wishlist?.appid ??
    identity?.appid ??
    price?.appid ??
    0;

  const title =
    wishlist?.title ??
    identity?.title ??
    `App ${appid}`;

  const criticScore = selectCriticScore(identity);
  const ttbMainH = identity?.ttbMedianMainH ?? library?.ttbMedianMainH ?? null;

  const priceFinal = price?.final ?? wishlist?.final ?? null;
  const priceInitial = price?.initial ?? wishlist?.initial ?? null;
  const currency = price?.currency ?? wishlist?.currency ?? null;
  const discountPercentRaw = price?.discountPercent ?? wishlist?.discountPercent ?? null;
  const discountPercent =
    discountPercentRaw != null ? Math.max(0, Math.min(100, discountPercentRaw)) : null;

  const saleEndISO = wishlist?.saleEndISO ?? null;
  const valuePerHour = computeValuePerHour(priceFinal, ttbMainH);
  const saleEndsInDays = computeSaleEndsInDays(saleEndISO);

  const dealScore = computeDealScore({
    discountPercent,
    priceFinal,
    valuePerHour,
    criticScore,
    installed: Boolean(library?.installed),
    inLibrary: Boolean(library),
    wishlist: Boolean(wishlist),
    saleEndsInDays,
  });

  return {
    appid,
    title,
    inLibrary: Boolean(library),
    installed: Boolean(library?.installed),
    identityId: identity?.id ?? null,
    currency,
    criticScore,
    ttbMainH,
    priceFinal,
    priceInitial,
    discountPercent,
    saleEndISO,
    valuePerHour,
    dealScore,
    wishlist: Boolean(wishlist),
  };
}

export async function getDealView(appid: number): Promise<DealView | null> {
  const [wishlist, price, identity] = await Promise.all([
    db.wishlists.where("appid").equals(appid).first(),
    db.steamPrices.get(appid),
    db.identities.where("appid").equals(appid).first(),
  ]);
  let library: LibraryItem | null = null;
  if (identity) {
    library =
      (await db.library.where("identityId").equals(identity.id).first()) ?? null;
  }
  if (!wishlist && !price && !identity) {
    return null;
  }
  return toDealView(identity ?? null, library, price ?? null, wishlist ?? undefined);
}

export async function listDealViews(): Promise<DealView[]> {
  const wishlists = await db.wishlists.toArray();
  if (!wishlists.length) {
    return [];
  }

  const appIds = Array.from(new Set(wishlists.map((item) => item.appid)));
  const identities = appIds.length
    ? await db.identities.where("appid").anyOf(appIds).toArray()
    : [];
  const identityByAppId = new Map<number, Identity>();
  identities.forEach((identity) => {
    if (identity.appid != null) {
      identityByAppId.set(identity.appid, identity);
    }
  });

  const identityIds = identities.map((identity) => identity.id);
  const libraryRows = identityIds.length
    ? await db.library.where("identityId").anyOf(identityIds).toArray()
    : [];
  const libraryByIdentityId = new Map<string, LibraryItem>();
  libraryRows.forEach((row) => {
    libraryByIdentityId.set(row.identityId, row);
  });

  const priceRows = appIds.length
    ? await db.steamPrices.where("appid").anyOf(appIds).toArray()
    : [];
  const priceByAppId = new Map<number, SteamPriceRow>();
  priceRows.forEach((row) => {
    priceByAppId.set(row.appid, row);
  });

  const viewsByAppId = new Map<number, DealView>();
  for (const wishlist of wishlists) {
    const identity = identityByAppId.get(wishlist.appid) ?? null;
    const library = identity ? libraryByIdentityId.get(identity.id) ?? null : null;
    const price = priceByAppId.get(wishlist.appid) ?? null;
    const view = toDealView(identity, library, price, wishlist);
    const previous = viewsByAppId.get(view.appid);
    if (!previous || view.dealScore > previous.dealScore) {
      viewsByAppId.set(view.appid, view);
    }
  }

  const views = Array.from(viewsByAppId.values());
  views.sort((a, b) => b.dealScore - a.dealScore);
  return views;
}
