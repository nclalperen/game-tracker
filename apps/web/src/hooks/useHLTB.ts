import { isTauri, fetchHLTB } from "@/desktop/bridge";
import { lookupLocalHLTB } from "@/data/localDatasets";

export function useHLTB() {
  const override = typeof localStorage !== "undefined" ? localStorage.getItem("hltb_enabled") : null;
  const enabled = override ? override === "1" : true;

  function cleanTitle(t: string) {
    return t.replace(/[™®©:]/g, "").replace(/\s+/g, " ").trim();
  }

  async function fetchTTB(title: string, platform?: string): Promise<{
    mainMedianHours: number | null;
    source: "hltb-local" | "hltb" | "hltb-cache" | "html" | "off";
  }> {
    if (!enabled) {
      return { mainMedianHours: null, source: "off" };
    }

    try {
      const localHours = await lookupLocalHLTB(title, platform);
      if (localHours != null) {
        return { mainMedianHours: localHours, source: "hltb-local" };
      }
    } catch (err) {
      console.warn("HLTB local lookup failed", err);
    }

    if (isTauri) {
      try {
        const res = await fetchHLTB(cleanTitle(title));
        return {
          mainMedianHours: res.mainMedianHours ?? null,
          source: res.source,
        };
      } catch (err) {
        console.error(err);
        return { mainMedianHours: null, source: "html" };
      }
    }

    return { mainMedianHours: null, source: "off" };
  }

  return { enabled, fetchTTB };
}

