let isTauri = false;
try { isTauri = typeof (window as any).__TAURI__ !== "undefined"; } catch {}
export { isTauri };

export type HLTBMeta = { mainMedianHours: number | null; source: string };

export async function fetchHLTBMeta(title: string): Promise<HLTBMeta> {
  if (!isTauri) throw new Error("HLTB fetch is desktop-only in this MVP.");
  const { fetchHLTBMetaNative } = await import("./hltb.desktop");
  return fetchHLTBMetaNative(title);
}
