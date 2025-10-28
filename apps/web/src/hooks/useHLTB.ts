import { isTauri, fetchHLTB } from "@/desktop/bridge";
import { lookupLocalHLTB } from "@/data/localDatasets";
import { useVendorFlag, isVendorEnabled } from "@/state/vendorFlags";

export function useHLTB() {
  const enabled = useVendorFlag("hltb");

  function cleanTitle(t: string) {
    return t.replace(/[Trc:]/g, "").replace(/\s+/g, " ").trim();
  }

  async function fetchTTB(title: string, platform?: string): Promise<{
    mainMedianHours: number | null;
    source: "hltb-local" | "hltb" | "hltb-cache" | "html" | "off";
  }> {
    if (!isVendorEnabled("hltb")) {
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
