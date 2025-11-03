import { useSyncExternalStore } from "react";

type WishlistSyncSnapshot = {
  running: boolean;
  message: string | null;
  current: number | null;
  total: number | null;
  success: boolean | null;
  startedAt: number | null;
  updatedAt: number | null;
};

const defaultSnapshot: WishlistSyncSnapshot = {
  running: false,
  message: null,
  current: null,
  total: null,
  success: null,
  startedAt: null,
  updatedAt: null,
};

let snapshot: WishlistSyncSnapshot = defaultSnapshot;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWishlistSync(): WishlistSyncSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function startWishlistSync(message: string) {
  snapshot = {
    ...defaultSnapshot,
    running: true,
    message,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  emit();
}

export function updateWishlistSync(
  message: string,
  progress?: { current?: number | null; total?: number | null },
) {
  if (!snapshot.running) return;
  snapshot = {
    ...snapshot,
    message,
    current: progress?.current ?? snapshot.current,
    total: progress?.total ?? snapshot.total,
    updatedAt: Date.now(),
  };
  emit();
}

export function finishWishlistSync(opts: { success: boolean; message?: string }) {
  snapshot = {
    ...snapshot,
    running: false,
    success: opts.success,
    message:
      opts.message ??
      (opts.success ? "Wishlist sync complete." : "Wishlist sync failed."),
    updatedAt: Date.now(),
  };
  emit();
}

export function resetWishlistSync() {
  snapshot = defaultSnapshot;
  emit();
}
