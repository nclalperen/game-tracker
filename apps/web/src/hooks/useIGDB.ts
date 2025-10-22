import { flags } from "@tracker/core";

type MetaResult = {
  ttbMedianMainH?: number | null;
  igdbCoverId?: string | null;
};

export function useIGDB() {
  // Local override so you can enable it in the running web app:
  const override = (typeof localStorage !== "undefined")
    && localStorage.getItem("igdb_enabled") === "1";

  // Coerce to boolean; if flags.igdbEnabled is falsey in web, override can enable it
  const enabled = override || !!(flags as any).igdbEnabled;

  async function fetchMeta(title: string): Promise<MetaResult> {
    if (!enabled) return { ttbMedianMainH: null, igdbCoverId: null };

    // MOCK until real IGDB keys are added:
    const seed = title.trim().toLowerCase().length;
    const ttb = Math.max(4, Math.min(60, seed * 2));
    const igdbCoverId = `co${100000 + seed * 137}`;

    return { ttbMedianMainH: ttb, igdbCoverId };
  }

  return { enabled, fetchMeta };
}
