import { flags } from "@tracker/core";

type MetaResult = {
  igdbCoverId?: string | null;
};

export function useIGDB() {
  // Local override so you can enable it in the running web app:
  const override = (typeof localStorage !== "undefined")
    && localStorage.getItem("igdb_enabled") === "1";

  // Coerce to boolean; if flags.igdbEnabled is falsey in web, override can enable it
  const enabled = override || !!(flags as any).igdbEnabled;

  async function fetchMeta(title: string): Promise<MetaResult> {
    if (!enabled) return { igdbCoverId: null };

    // MOCK until real IGDB keys are added:
    const seed = title.trim().toLowerCase().length;
    const igdbCoverId = `co${100000 + seed * 137}`;

    return { igdbCoverId };
  }

  return { enabled, fetchMeta };
}
