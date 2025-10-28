import { exportAll } from "./export";
import { getSetting, setSetting } from "@/db";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LAST_EXPORT_KEY = "ally.lastExportISO";

export async function maybeNightlyExport() {
  const last = await getSetting<string>(LAST_EXPORT_KEY);
  const lastTime = last ? Date.parse(last) : 0;
  if (Number.isNaN(lastTime) || Date.now() - lastTime > ONE_DAY_MS) {
    try {
      await exportAll();
      await setSetting(LAST_EXPORT_KEY, new Date().toISOString());
    } catch (error) {
      console.warn("Ally export failed (background):", error);
    }
  }
}
