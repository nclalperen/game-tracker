import { useCallback, useEffect, useState } from "react";
import { getWishlistItems, WISHLIST_SOURCE_STEAM } from "@/db";

export type WishlistSnapshot = {
  manual: Set<number>;
  all: Set<number>;
  refresh: () => Promise<void>;
};

export function useWishlistSnapshot(onError?: (message: string) => void): WishlistSnapshot {
  const [manual, setManual] = useState<Set<number>>(new Set());
  const [all, setAll] = useState<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const rows = await getWishlistItems();
      const manualSet = new Set<number>();
      const allSet = new Set<number>();
      rows.forEach((row) => {
        allSet.add(row.appid);
        if (row.source !== WISHLIST_SOURCE_STEAM) {
          manualSet.add(row.appid);
        }
      });
      setManual(manualSet);
      setAll(allSet);
    } catch (err) {
      if (onError) {
        const message =
          err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to load wishlist.";
        onError(message);
      }
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => {
      void refresh();
    };
    window.addEventListener("gt:wishlist-updated", handler);
    return () => {
      window.removeEventListener("gt:wishlist-updated", handler);
    };
  }, [refresh]);

  return { manual, all, refresh };
}
