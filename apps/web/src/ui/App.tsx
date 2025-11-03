import { useEffect } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { ensureSeed } from "@/utils/seed";
import EnrichmentHUD from "@/overlays/EnrichmentHUD";
import WishlistSyncHUD from "@/overlays/WishlistSyncHUD";
import { initSessionBridge } from "@/desktop/sessionBridge";
import { isTauri } from "@/desktop/bridge";
import { startAllyAutomationLoop } from "@/ally/automation";
import { check } from "@tauri-apps/plugin-updater";
import { getSetting, setSetting } from "@/db";

type UpdaterStatusSetting = {
  checkedAt?: string | null;
  available?: boolean;
  version?: string | null;
  error?: string | null;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function App() {
  useEffect(() => {
    ensureSeed();
    void initSessionBridge();
    let stopAutomation: (() => void) | undefined;
    if (isTauri) {
      const schedule = () => {
        if (typeof window === "undefined") return;
        const win = window as typeof window & {
          requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
        };
        const start = () => {
          stopAutomation = startAllyAutomationLoop();
        };
        if (typeof win.requestIdleCallback === "function") {
          win.requestIdleCallback(() => {
            start();
          });
        } else {
          setTimeout(() => {
            start();
          }, 0);
        }
      };
      schedule();
    }
    return () => {
      if (stopAutomation) {
        stopAutomation();
      }
    }
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    const maybeCheck = async () => {
      try {
        const stored = (await getSetting<UpdaterStatusSetting>("updater.lastStatus")) ?? {};
        const lastChecked = stored.checkedAt ? Date.parse(stored.checkedAt) : NaN;
        const now = Date.now();
        if (!Number.isFinite(lastChecked) || now - lastChecked > WEEK_MS) {
          const update = await check();
          const detail: UpdaterStatusSetting = {
            checkedAt: new Date().toISOString(),
            available: Boolean(update),
            version: update?.version ?? null,
            error: null,
          };
          if (update) {
            await update.close().catch(() => {});
          }
          await setSetting("updater.lastStatus", detail);
          if (!cancelled) {
            window.dispatchEvent(
              new CustomEvent("gt:updater-status", { detail: { ...detail, automatic: true } }),
            );
          }
        } else if (!cancelled) {
          window.dispatchEvent(
            new CustomEvent("gt:updater-status", {
              detail: { ...stored, cached: true },
            }),
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const detail: UpdaterStatusSetting = {
          checkedAt: new Date().toISOString(),
          available: false,
          version: null,
          error: message,
        };
        const payload = { ...detail, automatic: true };
        await setSetting("updater.lastStatus", detail).catch(() => {});
        if (!cancelled) {
          window.dispatchEvent(new CustomEvent("gt:updater-status", { detail: payload }));
        }
      }
    };
    void maybeCheck();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <EnrichmentHUD />
      <WishlistSyncHUD />
      <div className="max-w-6xl mx-auto p-4">
        <nav className="flex gap-4 mb-4">
          <NavLink to="/" end>Library</NavLink>
          <NavLink to="/explore">Explore</NavLink>
          <NavLink to="/wishlist">Wishlist</NavLink>
          <NavLink to="/deals">Deals</NavLink>
          <NavLink to="/suggestions">Suggestions</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <Outlet />
      </div>
    </>
  );
}
