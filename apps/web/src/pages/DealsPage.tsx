import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  db,
  addWishlistItem,
  removeWishlistItem,
  WISHLIST_SOURCE_USER,
  type DealView,
  type SteamPriceRow,
  type WishlistItem,
} from "@/db";
import { toDealView } from "@/deals/derive";
import { useWishlistSnapshot } from "@/hooks/useWishlistSnapshot";
import { formatCurrencySymbol, formatPriceFromMinor } from "@/utils/currency";
import type { Identity, LibraryItem } from "@tracker/core";

function formatSaleEnds(iso?: string | null): string {
  if (!iso) return "—";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  const diff = parsed - Date.now();
  if (diff <= 0) return "Ends soon";
  const days = diff / (24 * 60 * 60 * 1000);
  return `${days.toFixed(days >= 2 ? 0 : 1)}d`;
}

export default function DealsPage(): JSX.Element {
  const [deals, setDeals] = useState<DealView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [pendingWishlistAppIds, setPendingWishlistAppIds] = useState<Set<number>>(new Set());

  const { manual: manualWishlistAppIds, all: allWishlistAppIds, refresh: refreshWishlist } =
    useWishlistSnapshot((message) => setError(message));

  useEffect(() => {
    let cancelled = false;
    const loadDeals = async () => {
      setLoading(true);
      setError(null);
      try {
        const [prices, wishlists] = await Promise.all([db.steamPrices.toArray(), db.wishlists.toArray()]);
        if (cancelled) return;
        if (!prices.length && !wishlists.length) {
          setDeals([]);
          setLoading(false);
          return;
        }
        const appIdSet = new Set<number>();
        prices.forEach((price) => {
          if (price.appid > 0) appIdSet.add(price.appid);
        });
        wishlists.forEach((item) => {
          if (item.appid > 0) appIdSet.add(item.appid);
        });
        const appIds = Array.from(appIdSet);
        const identities = appIds.length
          ? await db.identities.where("appid").anyOf(appIds).toArray()
          : [];
        if (cancelled) return;
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
        if (cancelled) return;
        const libraryByIdentityId = new Map<string, LibraryItem>();
        libraryRows.forEach((row) => {
          libraryByIdentityId.set(row.identityId, row);
        });
        const priceByAppId = new Map<number, SteamPriceRow>();
        prices.forEach((price) => {
          priceByAppId.set(price.appid, price);
        });
        const wishlistByAppId = new Map<number, WishlistItem>();
        wishlists.forEach((item) => {
          if (!wishlistByAppId.has(item.appid) || item.source !== "steam") {
            wishlistByAppId.set(item.appid, item);
          }
        });
        const viewMap = new Map<number, DealView>();
        appIds.forEach((appid) => {
          const identity = identityByAppId.get(appid) ?? null;
          const library = identity ? libraryByIdentityId.get(identity.id) ?? null : null;
          const price = priceByAppId.get(appid) ?? null;
          const wishlist = wishlistByAppId.get(appid) ?? null;
          if (!price && !wishlist) return;
          const view = toDealView(identity, library, price ?? null, wishlist ?? undefined);
          if (!view.priceFinal && !view.discountPercent && !view.wishlist) return;
          const existing = viewMap.get(appid);
          if (!existing || view.dealScore > existing.dealScore) {
            viewMap.set(appid, view);
          }
        });
        const sorted = Array.from(viewMap.values())
          .filter((view) => !view.inLibrary)
          .sort((a, b) => b.dealScore - a.dealScore)
          .slice(0, 50);
        setDeals(sorted);
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to load deals.";
          setError(message);
          setDeals([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void loadDeals();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const handleWishlistToggle = useCallback(
    async (deal: DealView) => {
      const appid = deal.appid;
      if (!appid || appid <= 0) {
        setError("Cannot add this entry to the wishlist (missing Steam app id).");
        return;
      }
      if (pendingWishlistAppIds.has(appid)) return;
      setPendingWishlistAppIds((prev) => {
        const next = new Set(prev);
        next.add(appid);
        return next;
      });
      try {
        if (manualWishlistAppIds.has(appid)) {
          await removeWishlistItem(appid, WISHLIST_SOURCE_USER);
        } else {
          await addWishlistItem({
            appid,
            title: deal.title,
            platform: deal.inLibrary ? "Steam" : null,
            currency: deal.currency ?? null,
            final: deal.priceFinal ?? null,
            initial: deal.priceInitial ?? null,
            discountPercent: deal.discountPercent ?? null,
            saleEndISO: deal.saleEndISO ?? null,
          });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : typeof err === "string" ? err : "Wishlist update failed.";
        setError(message);
      } finally {
        setPendingWishlistAppIds((prev) => {
          const next = new Set(prev);
          next.delete(appid);
          return next;
        });
        void refreshWishlist();
      }
    },
    [manualWishlistAppIds, pendingWishlistAppIds, refreshWishlist],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Deals</h1>
          <p className="text-sm text-zinc-500">
            Top discounts sourced from your library, Steam prices, and wishlist sync. Tap a deal to open the Steam
            store or add it to your wishlist for later review.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost h-8 rounded-full px-4 text-xs font-semibold"
            onClick={() => setRefreshToken((token) => token + 1)}
            disabled={loading}
          >
            Refresh deals
          </button>
        </div>
      </header>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="space-y-3 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm">
              <div className="h-5 w-1/2 animate-pulse rounded bg-zinc-200" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-200" />
              <div className="h-4 w-full animate-pulse rounded bg-zinc-200" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 shadow-sm">
          {error}
        </div>
      ) : deals.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 shadow-sm">
          No deals detected yet. Import your Steam library or fetch latest prices to populate this list.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {deals.map((deal) => {
            const manualWishlisted = deal.appid != null && manualWishlistAppIds.has(deal.appid);
            const anyWishlisted = deal.appid != null && allWishlistAppIds.has(deal.appid);
            const pending = deal.appid != null && pendingWishlistAppIds.has(deal.appid);
            const wishlistLabel = pending
              ? "Saving..."
              : manualWishlisted
                ? "Wishlisted"
                : anyWishlisted
                  ? "On Steam"
                  : "Wishlist";
            const buttonDisabled =
              deal.appid == null || deal.appid <= 0 || pending || (!manualWishlisted && anyWishlisted);
            const priceLabel = formatPriceFromMinor(deal.currency ?? null, deal.priceFinal ?? null) ?? "—";
            const valueLabel =
              deal.valuePerHour != null && deal.currency
                ? `${formatCurrencySymbol(deal.currency) ?? deal.currency} ${deal.valuePerHour}`
                : "—";
            const discountLabel = deal.discountPercent != null ? `-${deal.discountPercent}%` : null;
            const storeUrl = deal.appid ? `https://store.steampowered.com/app/${deal.appid}/` : null;
            return (
              <article
                key={`${deal.appid}-${deal.identityId ?? "na"}`}
                className="flex h-full flex-col gap-4 rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold text-zinc-900 line-clamp-2">{deal.title}</h2>
                    <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                      <span
                        className={clsx(
                          "rounded-full border px-2 py-0.5 font-semibold",
                          deal.inLibrary ? "border-emerald-200 bg-emerald-50 text-emerald-600" : "border-zinc-200 bg-zinc-100",
                        )}
                      >
                        {deal.inLibrary ? "In library" : "Not owned"}
                      </span>
                      {deal.wishlist ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-600">
                          Steam wishlist
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {discountLabel ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600">
                        {discountLabel}
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
                        pending ? "opacity-60" : "",
                      )}
                      disabled={buttonDisabled}
                      onClick={() => {
                        if (buttonDisabled) return;
                        void handleWishlistToggle(deal);
                      }}
                    >
                      {wishlistLabel}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm text-zinc-600">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Current price</p>
                    <p className="font-semibold text-zinc-900">{priceLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Value / hour</p>
                    <p className="font-semibold text-zinc-900">{valueLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Sale ends</p>
                    <p className="font-semibold text-zinc-900">{formatSaleEnds(deal.saleEndISO)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Critic score</p>
                    <p className="font-semibold text-zinc-900">{deal.criticScore ?? "—"}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>Deal score {deal.dealScore.toFixed(1)}</span>
                  {storeUrl ? (
                    <a
                      href={storeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-emerald-600 hover:underline"
                    >
                      Open on Steam
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
