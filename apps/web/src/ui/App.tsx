import { useEffect } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { ensureSeed } from "@/utils/seed";
import EnrichmentHUD from "@/overlays/EnrichmentHUD";
import { initSessionBridge } from "@/desktop/session";
import { isTauri } from "@/desktop/bridge";
import { maybeNightlyExport } from "@/ally/scheduler";

export default function App() {
  useEffect(() => {
    ensureSeed();
    void initSessionBridge();
    if (isTauri) {
      const schedule = () => {
        if (typeof window === "undefined") return;
        const win = window as typeof window & {
          requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
        };
        if (typeof win.requestIdleCallback === "function") {
          win.requestIdleCallback(() => {
            void maybeNightlyExport();
          });
        } else {
          setTimeout(() => {
            void maybeNightlyExport();
          }, 0);
        }
      };
      schedule();
    }
  }, []);

  return (
    <>
      <EnrichmentHUD />
      <div className="max-w-6xl mx-auto p-4">
        <nav className="flex gap-4 mb-4">
          <NavLink to="/" end>Library</NavLink>
          <NavLink to="/explore">Explore</NavLink>
          <NavLink to="/suggestions">Suggestions</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <Outlet />
      </div>
    </>
  );
}
