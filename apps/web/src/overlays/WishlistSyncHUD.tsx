import { useEffect, useMemo, useState } from "react";
import { useWishlistSync, resetWishlistSync } from "@/state/wishlistSync";

const HIDE_SUCCESS_MS = 2500;
const HIDE_ERROR_MS = 4000;

export default function WishlistSyncHUD(): JSX.Element | null {
  const snapshot = useWishlistSync();
  const [visible, setVisible] = useState(false);

  const { running, success, message, current, total, updatedAt } = snapshot;

  useEffect(() => {
    if (running) {
      setVisible(true);
      return;
    }
    if (success != null) {
      setVisible(true);
      const timeout = setTimeout(() => {
        setVisible(false);
        resetWishlistSync();
      }, success ? HIDE_SUCCESS_MS : HIDE_ERROR_MS);
      return () => clearTimeout(timeout);
    }
    setVisible(false);
    return () => {};
  }, [running, success, updatedAt]);

  const subtitle = useMemo(() => {
    if (message) return message;
    if (running) return "Talking to Steam…";
    if (success === true) return "Wishlist sync complete.";
    if (success === false) return "Wishlist sync failed.";
    return null;
  }, [message, running, success]);

  if (!visible) return null;

  const showProgress =
    running && current != null && total != null && total > 0;

  const headline = running
    ? "Syncing Steam wishlist…"
    : success
      ? "Wishlist synced"
      : "Wishlist sync failed";

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-xl backdrop-blur">
        <div className="relative h-10 w-10">
          {running ? (
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          ) : success ? (
            <div className="grid h-full w-full place-items-center rounded-full bg-emerald-500 text-white">
              <span className="text-sm font-semibold">✓</span>
            </div>
          ) : (
            <div className="grid h-full w-full place-items-center rounded-full bg-rose-500 text-white">
              <span className="text-sm font-semibold">!</span>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900">{headline}</p>
          {subtitle ? (
            <p className="truncate text-xs text-zinc-500">{subtitle}</p>
          ) : null}
          {showProgress ? (
            <p className="text-xs text-emerald-600">
              Processed {current} of {total}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
