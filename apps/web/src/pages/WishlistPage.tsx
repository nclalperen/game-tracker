import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  db,
  getWishlistItems,
  removeWishlistItem,
  clearWishlist,
  WISHLIST_SOURCE_STEAM,
  WISHLIST_SOURCE_USER,
  type WishlistItem,
  type DealView,
} from "@/db";
import { listDealViews } from "@/deals/derive";
import { formatCurrencySymbol, formatPriceFromMinor } from "@/utils/currency";

type WishlistGroup = {
  appid: number;
  title: string;
  items: WishlistItem[];
  deal: DealView | null;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleDateString();
}

function getLatestAdded(items: WishlistItem[]): number {
  return items.reduce((latest, item) => {
    const ts = item.addedAtISO ? Date.parse(item.addedAtISO) : 0;
    return Math.max(latest, Number.isNaN(ts) ? 0 : ts);
  }, 0);
}

function computeSaleEndsInDays(iso?: string | null): string {
  if (!iso) return "-";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "-";
  const diff = parsed - Date.now();
  if (diff <= 0) return "Ends soon";
  const days = diff / (24 * 60 * 60 * 1000);
  return `${days.toFixed(days >= 2 ? 0 : 1)}d`;
}

export default function WishlistPage(): JSX.Element {
  const [groups, setGroups] = useState<WishlistGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [items, deals] = await Promise.all([getWishlistItems(), listDealViews()]);
        if (cancelled) return;
        const dealMap = new Map<number, DealView>();
        deals.forEach((deal) => {
          dealMap.set(deal.appid, deal);
        });
        const grouped = new Map<number, WishlistGroup>();
        items.forEach((item) => {
          const existing = grouped.get(item.appid);
          if (existing) {
            existing.items.push(item);
          } else {
            grouped.set(item.appid, {
              appid: item.appid,
              title: item.title,
              items: [item],
              deal: dealMap.get(item.appid) ?? null,
            });
          }
        });
        const groupsArray = Array.from(grouped.values());
        const appIds = groupsArray.map((group) => group.appid).filter((id) => id > 0);
        const [identityRows, steamAppRows] = await Promise.all([
          appIds.length ? db.identities.where("appid").anyOf(appIds).toArray() : [],
          appIds.length ? db.steamApps.where("appid").anyOf(appIds).toArray() : [],
        ]);
        const identityByAppId = new Map(identityRows.map((identity) => [identity.appid!, identity.title]));
        const steamAppById = new Map(steamAppRows.map((app) => [app.appid, app.name]));

        const rows = groupsArray.map((group) => {
          const dealTitle = group.deal?.title;
          const itemTitle = group.items[0]?.title;
          const fallback = `App ${group.appid}`;
          let title = dealTitle ?? itemTitle ?? fallback;
          const needsLookup =
            !title ||
            title === "App" ||
            title.startsWith("App ") ||
            title === `App ${group.appid}` ||
            title.startsWith("Unknown App");
          if (needsLookup) {
            title =
              identityByAppId.get(group.appid) ?? steamAppById.get(group.appid) ?? itemTitle ?? fallback;
          }
          return {
            ...group,
            title,
          };
        });
        rows.sort((a, b) => {
          const scoreA = a.deal?.dealScore ?? 0;
          const scoreB = b.deal?.dealScore ?? 0;
          if (scoreA !== scoreB) return scoreB - scoreA;
          const addedA = getLatestAdded(a.items);
          const addedB = getLatestAdded(b.items);
          return addedB - addedA;
        });
        setGroups(rows);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to load wishlist.";
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  useEffect(() => {
    const handler = () => {
      setRefreshToken((token) => token + 1);
    };
    window.addEventListener("gt:wishlist-updated", handler);
    return () => {
      window.removeEventListener("gt:wishlist-updated", handler);
    };
  }, []);

  const totalCount = useMemo(
    () => groups.reduce((sum, group) => sum + group.items.length, 0),
    [groups],
  );

  const handleManualRemove = async (appid: number) => {
    try {
      await removeWishlistItem(appid, WISHLIST_SOURCE_USER);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to update wishlist.";
      setError(message);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("Remove all wishlist entries? This includes Steam and manual items.")) {
      return;
    }
    try {
      await clearWishlist();
      setRefreshToken((token) => token + 1);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to clear wishlist.";
      setError(message);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-900">Wishlist</h1>
        <p className="text-sm text-zinc-600">
          Steam imports and manual picks live together here. Prices refresh whenever you sync your wishlist or
          fetch Steam prices.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-semibold text-zinc-600">
            {totalCount} item{totalCount === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="btn-ghost h-7 px-3"
            onClick={() => setRefreshToken((token) => token + 1)}
            disabled={loading}
          >
            Refresh
          </button>
          {groups.length ? (
            <button
              type="button"
              className="btn-ghost h-7 px-3 text-rose-600 hover:text-rose-700"
              onClick={handleClearAll}
              disabled={loading}
            >
              Clear all
            </button>
          ) : null}
        </div>
      </header>

      {loading ? (
        <div className="space-y-3">
          <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-200" />
          <div className="h-40 w-full animate-pulse rounded bg-zinc-200" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm">
          No wishlisted games yet. Import from Steam or add favourites from Explore and Deals.
        </div>
      ) : (
        <div className="rounded-3xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Sources</th>
                <th className="px-4 py-3 text-left">Cheapest price</th>
                <th className="px-4 py-3 text-left">Discount</th>
                <th className="px-4 py-3 text-left">Value / h</th>
                <th className="px-4 py-3 text-left">Last synced</th>
                <th className="px-4 py-3 text-left">Sale ends</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const deal = group.deal;
                const currency = deal?.currency ?? group.items.find((item) => item.currency)?.currency ?? null;
                const manualFinal = group.items
                  .map((item) => item.final)
                  .filter((value): value is number => value != null)
                  .sort((a, b) => a - b)[0] ?? null;
                const priceMinor = deal?.priceFinal ?? manualFinal;
                const discountPercent =
                  deal?.discountPercent ??
                  group.items.find((item) => item.discountPercent != null)?.discountPercent ??
                  null;
                const saleEndISO = deal?.saleEndISO ?? group.items.find((item) => item.saleEndISO)?.saleEndISO ?? null;
                const lastFetched =
                  group.items
                    .map((item) => item.lastFetchedISO)
                    .filter((value): value is string => Boolean(value))
                    .sort()
                    .pop() ?? null;
                const hasManual = group.items.some((item) => item.source !== WISHLIST_SOURCE_STEAM);
                const storeUrl =
                  group.appid > 0 ? `https://store.steampowered.com/app/${group.appid}/` : null;
                return (
                  <tr key={group.appid} className="border-t border-zinc-100">
                    <td className="px-4 py-3 align-top">
                      <div className="space-y-1">
                        <span className="font-semibold text-zinc-900">{group.title}</span>
                        {deal?.inLibrary ? (
                          <span className="text-xs font-medium text-emerald-600">Already in library</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1">
                        {group.items.map((item, index) => (
                          <span
                            key={`${item.source}-${index}`}
                            className={clsx(
                              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              item.source === WISHLIST_SOURCE_STEAM
                                ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                                : "bg-indigo-50 text-indigo-600 border border-indigo-200",
                            )}
                          >
                            {item.source === WISHLIST_SOURCE_STEAM ? "Steam" : "Manual"}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top font-medium text-zinc-900">
                      {formatPriceFromMinor(currency, priceMinor) ?? "-"}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {discountPercent != null ? `-${discountPercent}%` : "—"}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {deal?.valuePerHour != null && deal.currency
                        ? `${formatCurrencySymbol(deal.currency) ?? deal.currency} ${deal.valuePerHour}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 align-top">{formatDate(lastFetched)}</td>
                    <td className="px-4 py-3 align-top">{computeSaleEndsInDays(saleEndISO)}</td>
                    <td className="px-4 py-3 align-top text-right">
                      <div className="flex justify-end gap-2">
                        {storeUrl ? (
                          <a
                            href={storeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-ghost h-8 rounded-full px-3 text-xs font-semibold"
                          >
                            Open Steam
                          </a>
                        ) : null}
                        {hasManual ? (
                          <button
                            type="button"
                            className="btn-ghost h-8 rounded-full px-3 text-xs font-semibold text-rose-600 hover:text-rose-700"
                            onClick={() => handleManualRemove(group.appid)}
                          >
                            Remove manual
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
